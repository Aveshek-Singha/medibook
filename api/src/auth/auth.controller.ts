import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AuthService, AuthSession } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const COOKIE_NAME = 'medibook_refresh';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a patient account' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.withRefreshCookie(
      await this.auth.registerPatient(dto),
      response,
    );
  }

  @Post('login')
  @Throttle({
    default: {
      limit: () => Number(process.env.LOGIN_THROTTLE_LIMIT ?? 5),
      ttl: () => Number(process.env.THROTTLE_TTL ?? 60_000),
    },
  })
  @ApiOperation({ summary: 'Log in and establish a refresh-cookie session' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.withRefreshCookie(
      await this.auth.login(dto.email, dto.password),
      response,
    );
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Rotate the refresh token and issue a new access token',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedOrigin(request);
    const session = await this.auth.refresh(request.cookies?.[COOKIE_NAME]);
    return this.withRefreshCookie(session, response);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedOrigin(request);
    await this.auth.logout(request.cookies?.[COOKIE_NAME]);
    response.clearCookie(COOKIE_NAME, this.cookieOptions());
    return { message: 'Signed out' };
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Return the current user profile' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user: this.auth.toCurrentUser(user) };
  }

  private withRefreshCookie(session: AuthSession, response: Response) {
    response.cookie(COOKIE_NAME, session.refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.refreshMaxAge(),
    });
    return { accessToken: session.accessToken, user: session.user };
  }

  private cookieOptions() {
    const prefix = this.config
      .get<string>('API_PREFIX', 'api')
      .replace(/^\/+|\/+$/g, '');
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>(
      'COOKIE_SAME_SITE',
      production ? 'none' : 'lax',
    );
    return {
      httpOnly: true,
      secure: production || sameSite === 'none',
      sameSite,
      path: `/${prefix}/v1/auth`,
    };
  }

  private refreshMaxAge() {
    const value = this.config.get<string>('JWT_REFRESH_TTL', '7d');
    const match = /^(\d+)(s|m|h|d)$/i.exec(value);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const factor: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return Number(match[1]) * factor[match[2].toLowerCase()];
  }

  private assertTrustedOrigin(request: Request) {
    const origin = request.get('origin');
    const allowed = this.config
      .get<string>('WEB_URL', 'http://localhost:3000')
      .split(',')
      .map((value) => value.trim().replace(/\/$/, ''));
    if (!origin || !allowed.includes(origin.replace(/\/$/, ''))) {
      throw new UnauthorizedException('Request origin is not allowed');
    }
  }
}

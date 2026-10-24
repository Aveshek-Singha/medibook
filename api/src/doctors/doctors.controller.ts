import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DoctorQueryDto } from './dto/doctor-query.dto';
import { DoctorsService } from './doctors.service';

@ApiTags('doctors')
@Controller({ path: 'doctors', version: '1' })
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  @ApiOperation({ summary: 'Browse active doctors' })
  list(@Query() query: DoctorQueryDto) {
    return this.doctors.list(query);
  }

  @Get('specialties')
  @ApiOperation({ summary: 'List active doctor specialties' })
  specialties() {
    return this.doctors.specialties();
  }

  @Get(':id/slots')
  @ApiOperation({
    summary: 'List available doctor slots for a Dhaka calendar day',
  })
  slots(@Param('id') id: string, @Query('date') date?: string) {
    return this.doctors.availableSlots(id, date);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a doctor profile' })
  get(@Param('id') id: string) {
    return this.doctors.get(id);
  }
}

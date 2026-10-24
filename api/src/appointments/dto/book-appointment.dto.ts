import { IsString, Matches } from 'class-validator';

export class BookAppointmentDto {
  @IsString()
  @Matches(/^[1-9]\d{0,19}$/)
  slotId: string;
}

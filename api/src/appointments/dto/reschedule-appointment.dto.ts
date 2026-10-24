import { IsString, Matches } from 'class-validator';

export class RescheduleAppointmentDto {
  @IsString()
  @Matches(/^[1-9]\d{0,19}$/)
  newSlotId: string;
}

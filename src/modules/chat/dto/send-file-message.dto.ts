import { IsString, IsOptional } from 'class-validator';

export class SendFileMessageDto {
  @IsString()
  @IsOptional()
  request?: string;
}

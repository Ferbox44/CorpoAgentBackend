import { Controller, Post, Body, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { DataAgentService } from './data_agent.service';
import { FileInterceptor } from "@nestjs/platform-express";
import { createRequire } from "module";

const pdfParse = require("pdf-parse");
@Controller('data-agent')
export class DataAgentController {
  constructor(private readonly dataAgentService: DataAgentService) { }


  @Post("analyze")
  async analyze(@Body() body: { data: string }) {
    return await this.dataAgentService.analyzeData(body.data);
  }

  // @Post("process")
  // async process(@Body() body: { data: string }) {
  //   return await this.dataAgentService.analyzeAndProcess(body.data);
  // }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    let text = '';

    if (ext === 'csv' || ext === 'txt') {
      text = file.buffer.toString('utf8');
    } else if (ext === 'pdf') {
      const pdfData = await pdfParse(file.buffer);
      text = pdfData.text;
    } else {
      text = file.buffer.toString('utf8');
    }

    const result = await this.dataAgentService.analyzeAndProcess(
      text,
      file.originalname,
      'uploaded',
    );

    return {
      message: 'File processed and saved',
      recordId: result.recordId,
      analysis: result.analysis,
    };
  }
}



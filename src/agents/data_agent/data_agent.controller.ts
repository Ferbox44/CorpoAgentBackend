import { Controller, Post, Body, UseInterceptors, UploadedFile,BadRequestException } from '@nestjs/common';
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

  @Post("process")
  async process(@Body() body: { data: string }) {
    return await this.dataAgentService.analyzeAndProcess(body.data);
  }
  
  @Post("process-file")
  @UseInterceptors(FileInterceptor("file",{
    limits: {fileSize : 10 * 1024 * 1024}, // 10 MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["text/csv", "application/pdf"];
        if (!allowedTypes.includes(file.mimetype)) {
          return cb(new BadRequestException("Only CSV and PDF files are allowed"), false);
        }
        cb(null, true);
      },
    })
  )
  async processFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");

    const ext = file.originalname.split(".").pop()?.toLowerCase();
    let textContent = "";

    if (ext === "csv") {
      textContent = file.buffer ? file.buffer.toString("utf-8") : "";
    } else if (ext === "pdf") {
      const pdfData = await pdfParse(file.buffer);
      textContent = pdfData.text;
    } else {
      throw new BadRequestException("Unsupported file type. Only CSV and PDF are allowed.");
    }

    return await this.dataAgentService.analyzeAndProcess(textContent);
  }
  
}

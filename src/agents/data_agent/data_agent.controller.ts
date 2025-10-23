// import { Controller, Post, Body, UseInterceptors, UploadedFile, BadRequestException, Get, Param } from '@nestjs/common';
// import { DataAgentService } from './data_agent.service';
// import { FileInterceptor } from "@nestjs/platform-express";
// const pdfExtractText = require('pdf-parse');

// @Controller('data-agent')
// export class DataAgentController {
//   constructor(private readonly dataAgentService: DataAgentService) { }

//   @Get('by-id/:id')
//   async getById(@Param('id') id: string) {
//     return this.dataAgentService.getRecordById(id);
//   }

//   @Get('by-name/:filename')
//   async getByName(@Param('filename') filename: string) {
//     return this.dataAgentService.findRecordByFilename(filename);
//   }

//   @Post("analyze")
//   async analyze(@Body() body: { data: string }) {
//     return await this.dataAgentService.analyzeData(body.data);
//   }

//   @Post('upload')
//   @UseInterceptors(FileInterceptor('file'))
//   async uploadFile(@UploadedFile() file: Express.Multer.File) {
//     if (!file) {
//       throw new BadRequestException('No file uploaded');
//     }

//     console.log('=== FILE UPLOAD DEBUG ===');
//     console.log('Original filename:', file.originalname);
//     console.log('File size:', file.size, 'bytes');
//     console.log('Buffer length:', file.buffer.length);

//     // Extract extension and prepare text
//     const ext = file.originalname.split('.').pop()?.toLowerCase() || 'unknown';
//     let text = '';

//     try {
//       if (ext === 'csv' || ext === 'txt') {
//         // Use utf8 encoding explicitly
//         text = file.buffer.toString('utf8');
//         console.log('Text extracted (CSV/TXT), length:', text.length);
//         console.log('Number of lines:', text.split('\n').length);
//         console.log('First 300 chars:', text.substring(0, 300));
//         console.log('Last 300 chars:', text.substring(Math.max(0, text.length - 300)));
//       } else if (ext === 'pdf') {
//         const pdfData = await pdfExtractText(file.buffer);
//         text = pdfData.text;
//         console.log('Text extracted (PDF), length:', text.length);
//       } else {
//         // Fallback for unknown extensions
//         text = file.buffer.toString('utf8');
//         console.log('Text extracted (unknown type), length:', text.length);
//       }
//     } catch (error) {
//       console.error('Error extracting text from file:', error);
//       throw new BadRequestException(`Failed to extract text from file: ${error.message}`);
//     }

//     if (!text || text.trim().length === 0) {
//       throw new BadRequestException('File appears to be empty or could not be read');
//     }

//     console.log('=== SENDING TO SERVICE ===');
//     console.log('Text length being sent:', text.length);
//     console.log('First 200 chars of text:', text.substring(0, 200));

//     // Call service to analyze, process and save
//     const result = await this.dataAgentService.analyzeAndProcess(
//       text,
//       file.originalname,
//       undefined  // tags should be undefined or a string, not 'No summary yet'
//     );

//     return {
//       message: 'File processed and saved',
//       recordId: result.recordId,
//       analysis: result.analysis,
//       processedDataPreview: result.processedData.substring(0, 500) + '...',
//     };
//   }

//   @Post('upload-test')
//   @UseInterceptors(FileInterceptor('file'))
//   async uploadTestFile(@UploadedFile() file: Express.Multer.File) {
//     if (!file) {
//       throw new BadRequestException('No file uploaded');
//     }

//     const ext = file.originalname.split('.').pop()?.toLowerCase() || 'unknown';
//     let text = '';

//     if (ext === 'csv' || ext === 'txt') {
//       text = file.buffer.toString('utf8');
//     } else if (ext === 'pdf') {
//       const pdfData = await pdfExtractText(file.buffer);
//       text = pdfData.text;
//     } else {
//       text = file.buffer.toString('utf8');
//     }

//     // Return raw data without processing for debugging
//     return {
//       filename: file.originalname,
//       fileSize: file.size,
//       extension: ext,
//       textLength: text.length,
//       lineCount: text.split('\n').length,
//       firstLines: text.split('\n').slice(0, 10).join('\n'),
//       lastLines: text.split('\n').slice(-5).join('\n'),
//       fullText: text,  // Be careful with large files!
//     };
//   }
// }
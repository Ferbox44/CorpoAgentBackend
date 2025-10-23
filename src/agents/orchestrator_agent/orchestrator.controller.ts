// import {
//   Controller,
//   Post,
//   Body,
//   UseInterceptors,
//   UploadedFile,
//   BadRequestException,
// } from '@nestjs/common';
// import { FileInterceptor } from '@nestjs/platform-express';
// import { OrchestratorService } from './orchestrator.service';

// @Controller('orchestrator')
// export class OrchestratorController {
//   constructor(private readonly orchestratorService: OrchestratorService) {}

//   @Post('process')
//   async processRequest(
//     @Body() body: {
//       request: string;
//       context?: any;
//     }
//   ) {
//     if (!body.request) {
//       throw new BadRequestException('Request is required');
//     }

//     return this.orchestratorService.processRequest(body.request, body.context);
//   }

//   @Post('upload-and-process')
//   @UseInterceptors(FileInterceptor('file'))
//   async uploadAndProcess(
//     @UploadedFile() file: Express.Multer.File,
//     @Body() body: { request?: string }
//   ) {
//     if (!file) {
//       throw new BadRequestException('No file uploaded');
//     }

//     // Default request if not provided
//     const request = body.request || 'Process and analyze this file, then generate a comprehensive report';

//     return this.orchestratorService.processFileUpload(file, request);
//   }

//   @Post('process-and-report')
//   async processAndReport(
//     @Body() body: {
//       filename: string;
//       recipientEmail?: string;
//     }
//   ) {
//     if (!body.filename) {
//       throw new BadRequestException('Filename is required');
//     }

//     return this.orchestratorService.processAndReport(
//       body.filename,
//       body.recipientEmail || 'default@example.com'
//     );
//   }

//   @Post('quick-workflow')
//   async quickWorkflow(
//     @Body() body: {
//       workflowType: 'analyze' | 'report' | 'full';
//       recordId?: string;
//       filename?: string;
//     }
//   ) {
//     let request: string;

//     switch (body.workflowType) {
//       case 'analyze':
//         request = 'Analyze the data and provide insights';
//         break;
//       case 'report':
//         request = 'Generate a comprehensive report with statistics and insights';
//         break;
//       case 'full':
//         request = 'Process the data, generate a report, and provide actionable recommendations';
//         break;
//       default:
//         throw new BadRequestException('Invalid workflow type');
//     }

//     const context = {
//       recordId: body.recordId,
//       filename: body.filename,
//     };

//     return this.orchestratorService.processRequest(request, context);
//   }
// }
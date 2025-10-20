import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Get,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UniAgentService } from './uni-agent.service';

@Controller('agent')
export class UniAgentController {
  constructor(private readonly agentService: UniAgentService) {}

  /**
   * Main endpoint: Process any request with natural language
   * Examples:
   * - "Process employees.csv and generate a report"
   * - "Get data from record abc-123 and create PDF report"
   * - "Analyze the uploaded data and export as markdown"
   */
  @Post('process')
  async processRequest(
    @Body() body: {
      request: string;
      context?: any;
    }
  ) {
    if (!body.request) {
      throw new BadRequestException('Request is required');
    }

    return this.agentService.processRequest(body.request, body.context);
  }

  /**
   * Upload file and process with custom request
   * File will be automatically extracted and processed based on the request
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { request?: string }
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const request = body.request || 'Process this file, clean and validate the data, then save it to the database';

    return this.agentService.processFileUpload(file, request);
  }

  /**
   * Quick action: Upload and generate report in one step
   */
  @Post('upload-and-report')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAndReport(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { reportType?: 'pdf' | 'markdown' | 'standard' }
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const reportType = body.reportType || 'standard';
    const request = `Process this file, save it to the database, and generate a ${reportType} report`;

    return this.agentService.processFileUpload(file, request);
  }

  /**
   * Generate report from existing data
   */
  @Post('report')
  async generateReport(
    @Body() body: {
      recordId?: string;
      filename?: string;
      format?: 'standard' | 'pdf' | 'markdown';
    }
  ) {
    if (!body.recordId && !body.filename) {
      throw new BadRequestException('Either recordId or filename is required');
    }

    let request: string;
    if (body.format === 'pdf') {
      request = `Generate a PDF report from ${body.recordId ? `record ${body.recordId}` : `file ${body.filename}`}`;
    } else if (body.format === 'markdown') {
      request = `Generate a Markdown report from ${body.recordId ? `record ${body.recordId}` : `file ${body.filename}`}`;
    } else {
      request = `Generate a comprehensive report from ${body.recordId ? `record ${body.recordId}` : `file ${body.filename}`}`;
    }

    return this.agentService.processRequest(request, body);
  }

  /**
   * Get record by ID
   */
  @Get('record/:id')
  async getRecord(@Param('id') id: string) {
    return this.agentService.getRecordById(id);
  }

  /**
   * Get record by filename
   */
  @Get('record/filename/:filename')
  async getRecordByFilename(@Param('filename') filename: string) {
    return this.agentService.findRecordByFilename(filename);
  }

  /**
   * Quick workflows with predefined templates
   */
  @Post('quick-workflow')
  async quickWorkflow(
    @Body() body: {
      type: 'analyze' | 'report' | 'full' | 'export-pdf' | 'export-markdown';
      recordId?: string;
      filename?: string;
    }
  ) {
    if (!body.recordId && !body.filename) {
      throw new BadRequestException('Either recordId or filename is required');
    }

    let request: string;
    const source = body.recordId ? `record ${body.recordId}` : `file ${body.filename}`;

    switch (body.type) {
      case 'analyze':
        request = `Analyze the data from ${source} and provide insights`;
        break;
      case 'report':
        request = `Generate a comprehensive report with statistics and insights from ${source}`;
        break;
      case 'full':
        request = `Retrieve ${source}, analyze it, generate a report, and provide actionable recommendations`;
        break;
      case 'export-pdf':
        request = `Export ${source} as a PDF report with full analysis`;
        break;
      case 'export-markdown':
        request = `Export ${source} as a Markdown report`;
        break;
      default:
        throw new BadRequestException('Invalid workflow type');
    }

    const context = {
      recordId: body.recordId,
      filename: body.filename,
    };

    return this.agentService.processRequest(request, context);
  }

  /**
   * Batch process multiple files
   */
  @Post('batch-upload')
  @UseInterceptors(FileInterceptor('files'))
  async batchUpload(
    @UploadedFile() files: Express.Multer.File[],
    @Body() body: { request?: string }
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const request = body.request || 'Process all files, clean and validate the data, then save to the database';
    
    // Explicitly type the results array
    const results: Array<{
      filename: string;
      status: 'success' | 'failed';
      result?: any;
      error?: string;
    }> = [];

    for (const file of files) {
      try {
        const result = await this.agentService.processFileUpload(file, request);
        results.push({
          filename: file.originalname,
          status: 'success',
          result,
        });
      } catch (error) {
        results.push({
          filename: file.originalname,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return {
      total: files.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      results,
    };
  }

  /**
   * Process data and send report (placeholder for email integration)
   */
  @Post('process-and-send')
  async processAndSend(
    @Body() body: {
      filename: string;
      recipientEmail: string;
      reportFormat?: 'pdf' | 'markdown';
    }
  ) {
    if (!body.filename) {
      throw new BadRequestException('Filename is required');
    }
    if (!body.recipientEmail) {
      throw new BadRequestException('Recipient email is required');
    }

    const format = body.reportFormat || 'pdf';
    const request = `
      Get the processed data file named "${body.filename}",
      generate a ${format} report with insights and recommendations,
      and prepare it to send to ${body.recipientEmail}
    `;

    return this.agentService.processRequest(request, {
      filename: body.filename,
      recipientEmail: body.recipientEmail,
      reportFormat: format,
    });
  }
}
import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Get,
  Param,
  Query,
  Headers,
  Res,
  UseGuards,
  Request
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UniAgentService } from './uni-agent.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';

@Controller('uni-agent')
@UseGuards(JwtAuthGuard)
export class UniAgentController {
  constructor(private readonly uniAgentService: UniAgentService) {}

  // ===== ORCHESTRATOR ENDPOINTS =====
  
  @Post('process')
  async processRequest(
    @Body() body: {
      request: string;
      context?: any;
    },
    @Request() req
  ) {
    if (!body.request) {
      throw new BadRequestException('Request is required');
    }

    // Add user context to the request
    const contextWithUser = {
      ...body.context,
      userId: req.user.userId,
      userEmail: req.user.email
    };

    return this.uniAgentService.processRequest(body.request, contextWithUser);
  }

  @Post('upload-and-process')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAndProcess(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { request?: string },
    @Request() req
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Default request if not provided
    const request = body.request || 'Process and analyze this file, then generate a comprehensive report';

    // Add user context to the request
    const contextWithUser = {
      userId: req.user.userId,
      userEmail: req.user.email
    };

    return this.uniAgentService.processFileUpload(file, request, contextWithUser);
  }

  @Post('process-and-report')
  async processAndReport(
    @Body() body: {
      filename: string;
      recipientEmail?: string;
    }
  ) {
    if (!body.filename) {
      throw new BadRequestException('Filename is required');
    }

    return this.uniAgentService.processAndReport(
      body.filename,
      body.recipientEmail || 'default@example.com'
    );
  }

  @Post('quick-workflow')
  async quickWorkflow(
    @Body() body: {
      workflowType: 'analyze' | 'report' | 'full';
      recordId?: string;
      filename?: string;
    }
  ) {
    let request: string;

    switch (body.workflowType) {
      case 'analyze':
        request = 'Analyze the data and provide insights';
        break;
      case 'report':
        request = 'Generate a comprehensive report with statistics and insights';
        break;
      case 'full':
        request = 'Process the data, generate a report, and provide actionable recommendations';
        break;
      default:
        throw new BadRequestException('Invalid workflow type');
    }

    const context = {
      recordId: body.recordId,
      filename: body.filename,
    };

    return this.uniAgentService.processRequest(request, context);
  }

  // ===== DATA AGENT ENDPOINTS =====

  @Get('by-id/:id')
  async getById(@Param('id') id: string) {
    return this.uniAgentService.getRecordById(id);
  }

  @Get('by-name/:filename')
  async getByName(@Param('filename') filename: string) {
    return this.uniAgentService.findRecordByFilename(filename);
  }

  @Post("analyze")
  async analyze(@Body() body: { data: string }) {
    return await this.uniAgentService.analyzeData(body.data);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // console.log('=== FILE UPLOAD DEBUG ===');
    // console.log('Original filename:', file.originalname);
    // console.log('File size:', file.size, 'bytes');
    // console.log('Buffer length:', file.buffer.length);

    // Extract extension and prepare text
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'unknown';
    let text = '';

    try {
      if (ext === 'csv' || ext === 'txt') {
        // Use utf8 encoding explicitly
        text = file.buffer.toString('utf8');
        // console.log('Text extracted (CSV/TXT), length:', text.length);
        // console.log('Number of lines:', text.split('\n').length);
        // console.log('First 300 chars:', text.substring(0, 300));
        // console.log('Last 300 chars:', text.substring(Math.max(0, text.length - 300)));
      } else if (ext === 'pdf') {
        const pdfExtractText = require('pdf-parse');
        const pdfData = await pdfExtractText(file.buffer);
        text = pdfData.text;
        // console.log('Text extracted (PDF), length:', text.length);
      } else {
        // Fallback for unknown extensions
        text = file.buffer.toString('utf8');
        // console.log('Text extracted (unknown type), length:', text.length);
      }
    } catch (error) {
      console.error('Error extracting text from file:', error);
      throw new BadRequestException(`Failed to extract text from file: ${error.message}`);
    }

    if (!text || text.trim().length === 0) {
      throw new BadRequestException('File appears to be empty or could not be read');
    }

    // console.log('=== SENDING TO SERVICE ===');
    // console.log('Text length being sent:', text.length);
    // console.log('First 200 chars of text:', text.substring(0, 200));

    // Call service to analyze, process and save
    const result = await this.uniAgentService.analyzeAndProcess(
      text,
      file.originalname,
      undefined  // tags should be undefined or a string, not 'No summary yet'
    );

    return {
      message: 'File processed and saved',
      recordId: result.recordId,
      analysis: result.analysis,
      processedDataPreview: result.processedData.substring(0, 500) + '...',
    };
  }

  @Post('upload-test')
  @UseInterceptors(FileInterceptor('file'))
  async uploadTestFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'unknown';
    let text = '';

    if (ext === 'csv' || ext === 'txt') {
      text = file.buffer.toString('utf8');
    } else if (ext === 'pdf') {
      const pdfExtractText = require('pdf-parse');
      const pdfData = await pdfExtractText(file.buffer);
      text = pdfData.text;
    } else {
      text = file.buffer.toString('utf8');
    }

    // Return raw data without processing for debugging
    return {
      filename: file.originalname,
      fileSize: file.size,
      extension: ext,
      textLength: text.length,
      lineCount: text.split('\n').length,
      firstLines: text.split('\n').slice(0, 10).join('\n'),
      lastLines: text.split('\n').slice(-5).join('\n'),
      fullText: text,  // Be careful with large files!
    };
  }

  // ===== REPORT AGENT ENDPOINTS =====

  @Post('generate')
  async generateReport(
    @Body() body: {
      recordId?: string;
      filename?: string;
      data?: string;
      reportType?: string;
    }
  ) {
    if (!body.recordId && !body.filename && !body.data) {
      throw new BadRequestException(
        'Must provide either recordId, filename, or data'
      );
    }

    const report = await this.uniAgentService.generateReport(body);
    return report;
  }

  @Post('summary')
  async createSummary(
    @Body() body: {
      recordId?: string;
      filename?: string;
      data?: string;
    }
  ) {
    if (!body.recordId && !body.filename && !body.data) {
      throw new BadRequestException(
        'Must provide either recordId, filename, or data'
      );
    }

    const summary = await this.uniAgentService.createSummary(body);
    return summary;
  }

  @Post('export/pdf')
  async exportPdf(
    @Body() body: {
      recordId?: string;
      filename?: string;
      data?: string;
      reportType?: string;
    },
    @Res() res: Response
  ) {
    // First generate the report
    const report = await this.uniAgentService.generateReport(body);
    
    // Then export it as PDF (HTML for now)
    const html = await this.uniAgentService.exportPdf(report);
    
    // Set headers for HTML response (would be PDF in production)
    res.setHeader('Content-Type', 'text/html');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${report.metadata.title}.html"`
    );
    
    return res.send(html);
  }

  @Post('export/markdown')
  async exportMarkdown(
    @Body() body: {
      recordId?: string;
      filename?: string;
      data?: string;
      reportType?: string;
    }
  ) {
    const report = await this.uniAgentService.generateReport(body);
    const markdown = await this.uniAgentService.formatReportAsMarkdown(report);
    
    return {
      filename: `${report.metadata.title}.md`,
      content: markdown,
    };
  }

  @Post('export/json')
  async exportJson(
    @Body() body: {
      recordId?: string;
      filename?: string;
      data?: string;
      reportType?: string;
    }
  ) {
    const report = await this.uniAgentService.generateReport(body);
    const json = await this.uniAgentService.formatReportAsJson(report);
    
    return json;
  }

  @Get('statistics/:id')
  async getStatistics(@Param('id') id: string) {
    // This would need to fetch the record first
    // For now, it's a placeholder
    return {
      message: 'Statistics endpoint',
      id,
    };
  }

  @Post('statistics')
  async getDataStatistics(@Body() body: { data: string }) {
    if (!body.data) {
      throw new BadRequestException('Data is required');
    }

    const stats = await this.uniAgentService.getDataStatistics(body.data);
    return stats;
  }
}

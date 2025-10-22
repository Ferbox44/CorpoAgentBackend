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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UniAgentService } from './uni-agent.service';

// DTOs for request validation
class ProcessRequestDto {
  request: string;
  context?: any;
}

class DirectProcessDto {
  filename: string;
  tags?: string;
}

class AnalyzeDataDto {
  data: string;
}

@Controller('uni-agent')
export class UniAgentController {
  constructor(private readonly uniAgentService: UniAgentService) {}

  /**
   * Main endpoint - processes any request with optional context
   * POST /uni-agent/process
   * Body: { request: string, context?: any }
   */
  @Post('process')
  @HttpCode(HttpStatus.OK)
  async processRequest(@Body() dto: ProcessRequestDto) {
    if (!dto.request || dto.request.trim().length === 0) {
      throw new BadRequestException('Request cannot be empty');
    }

    try {
      return await this.uniAgentService.processRequest(dto.request, dto.context);
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to process request',
        error: error.message,
        details: error.stack,
      });
    }
  }

  /**
   * File upload endpoint - processes uploaded files
   * POST /uni-agent/upload
   * Body (multipart/form-data): 
   *   - file: File
   *   - request: string (what to do with the file)
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('request') request: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!request || request.trim().length === 0) {
      throw new BadRequestException('Request parameter is required');
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 10MB limit');
    }

    // Validate file type
    const allowedExtensions = ['csv', 'txt', 'pdf', 'json'];
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!ext || !allowedExtensions.includes(ext)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${allowedExtensions.join(', ')}`
      );
    }

    try {
      return await this.uniAgentService.processFileUpload(file, request);
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to process uploaded file',
        error: error.message,
        filename: file.originalname,
      });
    }
  }

  /**
   * Quick process endpoint - for simple file processing
   * POST /uni-agent/process-file
   * Body: { filename: string, tags?: string }
   */
  @Post('process-file')
  @HttpCode(HttpStatus.OK)
  async processExistingFile(@Body() dto: DirectProcessDto) {
    if (!dto.filename || dto.filename.trim().length === 0) {
      throw new BadRequestException('Filename is required');
    }

    const request = `Process and clean the file named "${dto.filename}"`;
    const context = {
      filename: dto.filename,
      tags: dto.tags,
    };

    try {
      return await this.uniAgentService.processRequest(request, context);
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to process file',
        error: error.message,
        filename: dto.filename,
      });
    }
  }

  /**
   * Retrieve record by ID
   * GET /uni-agent/record/:id
   */
  @Get('record/:id')
  async getRecordById(@Param('id') id: string) {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Record ID is required');
    }

    const request = `Get the record with ID "${id}"`;
    const context = { id };

    try {
      const result = await this.uniAgentService.processRequest(request, context);
      return result.results?.[0] || result;
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to retrieve record',
        error: error.message,
        recordId: id,
      });
    }
  }

  /**
   * Retrieve record by filename
   * GET /uni-agent/record
   * Query: filename=employees.csv
   */
  @Get('record')
  async getRecordByFilename(@Query('filename') filename: string) {
    if (!filename || filename.trim().length === 0) {
      throw new BadRequestException('Filename query parameter is required');
    }

    const request = `Get the record for file "${filename}"`;
    const context = { filename };

    try {
      const result = await this.uniAgentService.processRequest(request, context);
      return result.results?.[0] || result;
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to retrieve record',
        error: error.message,
        filename,
      });
    }
  }

  /**
   * Analyze data quality without processing
   * POST /uni-agent/analyze
   * Body: { data: string }
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeData(@Body() dto: AnalyzeDataDto) {
    if (!dto.data || dto.data.trim().length === 0) {
      throw new BadRequestException('Data cannot be empty');
    }

    const request = 'Analyze the data quality and provide recommendations';
    const context = { fileData: dto.data };

    try {
      return await this.uniAgentService.processRequest(request, context);
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to analyze data',
        error: error.message,
      });
    }
  }

  /**
   * Workflow planning endpoint - plan without executing
   * POST /uni-agent/plan
   * Body: { request: string, context?: any }
   */
  @Post('plan')
  @HttpCode(HttpStatus.OK)
  async planWorkflow(@Body() dto: ProcessRequestDto) {
    if (!dto.request || dto.request.trim().length === 0) {
      throw new BadRequestException('Request cannot be empty');
    }

    const request = `Plan (but don't execute) the following workflow: ${dto.request}`;

    try {
      // This will trigger planning but we'll intercept before execution
      const result = await this.uniAgentService.processRequest(request, dto.context);
      return {
        plan: result.plan,
        message: 'Workflow planned successfully. Use /process to execute.',
      };
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to plan workflow',
        error: error.message,
      });
    }
  }

  

  /**
   * Health check endpoint
   * GET /uni-agent/health
   */
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      service: 'uni-agent',
      timestamp: new Date().toISOString(),
      message: 'UniAgent service is running',
    };
  }

  /**
   * Generate report from existing record
   * POST /uni-agent/report
   * Body: { recordId?, filename?, reportType? }
   */
  @Post('report')
  @HttpCode(HttpStatus.OK)
  async generateReport(
    @Body('recordId') recordId?: string,
    @Body('filename') filename?: string,
    @Body('reportType') reportType?: string,
  ) {
    if (!recordId && !filename) {
      throw new BadRequestException('Either recordId or filename is required');
    }

    try {
      return await this.uniAgentService.processRequest(
        'Generate a comprehensive report',
        { recordId, filename, reportType }
      );
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to generate report',
        error: error.message,
      });
    }
  }

  /**
   * Generate report and export as PDF/HTML
   * POST /uni-agent/report/pdf
   * Body: { recordId?, filename?, reportType? }
   */
  @Post('report/pdf')
  @HttpCode(HttpStatus.OK)
  async generatePdfReport(
    @Body('recordId') recordId?: string,
    @Body('filename') filename?: string,
    @Body('reportType') reportType?: string,
  ) {
    if (!recordId && !filename) {
      throw new BadRequestException('Either recordId or filename is required');
    }

    const request = 'Generate a report and export it as PDF';
    
    try {
      return await this.uniAgentService.processRequest(request, {
        recordId,
        filename,
        reportType,
      });
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to generate PDF report',
        error: error.message,
      });
    }
  }

  /**
   * Generate report and export as Markdown
   * POST /uni-agent/report/markdown
   * Body: { recordId?, filename?, reportType? }
   */
  @Post('report/markdown')
  @HttpCode(HttpStatus.OK)
  async generateMarkdownReport(
    @Body('recordId') recordId?: string,
    @Body('filename') filename?: string,
    @Body('reportType') reportType?: string,
  ) {
    if (!recordId && !filename) {
      throw new BadRequestException('Either recordId or filename is required');
    }

    const request = 'Generate a report and export it as Markdown';
    
    try {
      return await this.uniAgentService.processRequest(request, {
        recordId,
        filename,
        reportType,
      });
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to generate Markdown report',
        error: error.message,
      });
    }
  }

  /**
   * Create a quick summary of data
   * POST /uni-agent/summary
   * Body: { recordId?, filename?, data? }
   */
  @Post('summary')
  @HttpCode(HttpStatus.OK)
  async createSummary(
    @Body('recordId') recordId?: string,
    @Body('filename') filename?: string,
    @Body('data') data?: string,
  ) {
    if (!recordId && !filename && !data) {
      throw new BadRequestException('Either recordId, filename, or data is required');
    }

    const request = 'Create a quick summary';
    
    try {
      return await this.uniAgentService.processRequest(request, {
        recordId,
        filename,
        fileData: data,
      });
    } catch (error) {
      throw new BadRequestException({
        message: 'Failed to create summary',
        error: error.message,
      });
    }
  }

  /**
   * Get available actions/capabilities
   * GET /uni-agent/capabilities
   */
  @Get('capabilities')
  async getCapabilities() {
    return {
      actions: {
        retrieval: [
          'get_by_id - Retrieve a record by its ID',
          'get_by_filename - Retrieve a record by filename',
        ],
        processing: [
          'analyze_data - Analyze data quality',
          'clean_data - Remove nulls and format data',
          'transform_data - Standardize date/email/phone formats',
          'validate_data - Validate data integrity',
          'deduplicate_data - Remove duplicate rows',
          'normalize_data - Normalize text casing',
        ],
        storage: [
          'save_to_database - Save processed data to database',
        ],
        reporting: [
          'generate_report - Create comprehensive report',
          'create_summary - Create quick summary',
          'export_pdf - Export report as PDF/HTML',
          'export_markdown - Export report as Markdown',
          'export_json - Export report as JSON',
          'get_statistics - Get basic data statistics',
        ],
        workflow: [
          'plan_workflow - Create multi-step workflow plan',
          'execute_workflow - Execute a planned workflow',
        ],
      },
      endpoints: {
        main: 'POST /uni-agent/process',
        upload: 'POST /uni-agent/upload',
        retrieve: 'GET /uni-agent/record/:id or GET /uni-agent/record?filename=',
        analyze: 'POST /uni-agent/analyze',
        report: 'POST /uni-agent/report',
        reportPdf: 'POST /uni-agent/report/pdf',
        reportMarkdown: 'POST /uni-agent/report/markdown',
        summary: 'POST /uni-agent/summary',
        batch: 'POST /uni-agent/batch',
      },
      supportedFileTypes: ['csv', 'txt', 'pdf', 'json'],
      maxFileSize: '10MB',
    };
  }
}
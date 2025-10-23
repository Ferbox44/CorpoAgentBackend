// import { 
//   Controller, 
//   Post, 
//   Get, 
//   Body, 
//   Param, 
//   Query,
//   BadRequestException,
//   Headers,
//   Res
// } from '@nestjs/common';
// import type { Response } from 'express';
// import { ReportAgentService } from './report_agent.service';

// @Controller('report-agent')
// export class ReportAgentController {
//   constructor(private readonly reportAgentService: ReportAgentService) {}

//   @Post('generate')
//   async generateReport(
//     @Body() body: {
//       recordId?: string;
//       filename?: string;
//       data?: string;
//       reportType?: string;
//     }
//   ) {
//     if (!body.recordId && !body.filename && !body.data) {
//       throw new BadRequestException(
//         'Must provide either recordId, filename, or data'
//       );
//     }

//     const report = await this.reportAgentService.generateReport(body);
//     return report;
//   }

//   @Post('summary')
//   async createSummary(
//     @Body() body: {
//       recordId?: string;
//       filename?: string;
//       data?: string;
//     }
//   ) {
//     if (!body.recordId && !body.filename && !body.data) {
//       throw new BadRequestException(
//         'Must provide either recordId, filename, or data'
//       );
//     }

//     const summary = await this.reportAgentService.createSummary(body);
//     return summary;
//   }

//   @Post('export/pdf')
//   async exportPdf(
//     @Body() body: {
//       recordId?: string;
//       filename?: string;
//       data?: string;
//       reportType?: string;
//     },
//     @Res() res: Response
//   ) {
//     // First generate the report
//     const report = await this.reportAgentService.generateReport(body);
    
//     // Then export it as PDF (HTML for now)
//     const html = await this.reportAgentService.exportPdf(report);
    
//     // Set headers for HTML response (would be PDF in production)
//     res.setHeader('Content-Type', 'text/html');
//     res.setHeader(
//       'Content-Disposition',
//       `inline; filename="${report.metadata.title}.html"`
//     );
    
//     return res.send(html);
//   }

//   @Post('export/markdown')
//   async exportMarkdown(
//     @Body() body: {
//       recordId?: string;
//       filename?: string;
//       data?: string;
//       reportType?: string;
//     }
//   ) {
//     const report = await this.reportAgentService.generateReport(body);
//     const markdown = await this.reportAgentService.formatReportAsMarkdown(report);
    
//     return {
//       filename: `${report.metadata.title}.md`,
//       content: markdown,
//     };
//   }

//   @Post('export/json')
//   async exportJson(
//     @Body() body: {
//       recordId?: string;
//       filename?: string;
//       data?: string;
//       reportType?: string;
//     }
//   ) {
//     const report = await this.reportAgentService.generateReport(body);
//     const json = await this.reportAgentService.formatReportAsJson(report);
    
//     return json;
//   }

//   @Get('statistics/:id')
//   async getStatistics(@Param('id') id: string) {
//     // This would need to fetch the record first
//     // For now, it's a placeholder
//     return {
//       message: 'Statistics endpoint',
//       id,
//     };
//   }

//   @Post('statistics')
//   async getDataStatistics(@Body() body: { data: string }) {
//     if (!body.data) {
//       throw new BadRequestException('Data is required');
//     }

//     const stats = await this.reportAgentService.getDataStatistics(body.data);
//     return stats;
//   }
// }
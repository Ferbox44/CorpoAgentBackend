// import { Injectable, NotFoundException } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { ChatOllama } from '@langchain/ollama';
// import { ChatPromptTemplate } from '@langchain/core/prompts';
// import { z } from 'zod';
// import { StructuredOutputParser } from 'langchain/output_parsers';
// import { RunnableSequence } from '@langchain/core/runnables';
// import { KnowledgeBase } from '../../entities/knowledge_base.entity';
// import { AIMessage } from '@langchain/core/messages';

// export interface ReportMetadata {
//   title: string;
//   generatedAt: Date;
//   dataSource: string;
//   recordCount: number;
//   reportType: string;
// }

// export interface ReportSection {
//   title: string;
//   content: string;
//   insights?: string[];
// }

// export interface GeneratedReport {
//   metadata: ReportMetadata;
//   sections: ReportSection[];
//   summary: string;
//   recommendations?: string[];
// }

// @Injectable()
// export class ReportAgentService {
//   private readonly model: ChatOllama;
//   private summaryChain: RunnableSequence;
//   private insightsChain: RunnableSequence;

//   constructor(
//     @InjectRepository(KnowledgeBase)
//     private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
//   ) {
//     this.model = new ChatOllama({
//       model: 'llama3',
//       baseUrl: 'http://localhost:11434',
//       temperature: 0.3,
//     });

//     this.setupChains();
//   }

//   private setupChains() {
//     // Summary chain
//     const summarySchema = z.object({
//       summary: z.string(),
//       key_points: z.array(z.string()),
//       data_quality: z.string(),
//       record_count: z.number(),
//     });

//     const summaryParser = StructuredOutputParser.fromZodSchema(summarySchema);
//     const summaryFormatInstructions = summaryParser
//       .getFormatInstructions()
//       .replace(/{/g, '{{')
//       .replace(/}/g, '}}');

//     const summaryPromptTemplate = `
// You are a data analyst creating concise summaries of processed datasets.

// Analyze the following data and provide:
// 1. A brief summary (2-3 sentences) of what the data represents
// 2. Key points or notable patterns (3-5 bullet points)
// 3. Assessment of data quality (good/fair/poor with brief explanation)
// 4. Count of valid records

// DATA:
// {data}

// CRITICAL JSON FORMATTING RULES:
// - Respond with ONLY valid JSON - no markdown, no code blocks, no explanatory text
// - ALL strings in arrays MUST be wrapped in double quotes: ["item1", "item2"]
// - Do NOT write: [item1, item2] or ["item1, item2] - both are invalid
// - Every array element must be a complete quoted string
// - Do not wrap response in \`\`\`json or any other markers
// - Ensure all commas and brackets are properly placed

// Use this exact JSON format:
// ${summaryFormatInstructions}

// Respond with only the JSON object:`;

//     const summaryPrompt = ChatPromptTemplate.fromTemplate(summaryPromptTemplate);
//     this.summaryChain = RunnableSequence.from([
//       summaryPrompt,
//       this.model,
//       (output: AIMessage | string) => this.parseJSON(output, summaryParser),
//     ]);

//     // Insights chain
//     const insightsSchema = z.object({
//       insights: z.array(z.string()),
//       trends: z.array(z.string()),
//       anomalies: z.array(z.string()),
//       recommendations: z.array(z.string()),
//     });

//     const insightsParser = StructuredOutputParser.fromZodSchema(insightsSchema);
//     const insightsFormatInstructions = insightsParser
//       .getFormatInstructions()
//       .replace(/{/g, '{{')
//       .replace(/}/g, '}}');

//     const insightsPromptTemplate = `
// You are a data analyst providing deep insights from processed data.

// Analyze the data and identify:
// 1. Key insights (3-5 meaningful observations)
// 2. Trends or patterns (2-4 trends)
// 3. Anomalies or outliers (if any, 0-3)
// 4. Actionable recommendations (2-4 suggestions)

// DATA:
// {data}

// SUMMARY CONTEXT:
// {summary}

// CRITICAL JSON FORMATTING RULES:
// - Respond with ONLY valid JSON - no markdown, no code blocks, no explanatory text
// - ALL strings in arrays MUST be wrapped in double quotes: ["item1", "item2"]
// - Do NOT write: [item1, item2] or ["item1, item2] - both are invalid
// - Every array element must be a complete quoted string on one line
// - Do not wrap response in \`\`\`json or any other markers
// - Ensure all commas and brackets are properly placed

// Use this exact JSON format:
// ${insightsFormatInstructions}

// Respond with only the JSON object:`;

//     const insightsPrompt = ChatPromptTemplate.fromTemplate(insightsPromptTemplate);
//     this.insightsChain = RunnableSequence.from([
//       insightsPrompt,
//       this.model,
//       (output: AIMessage | string) => this.parseJSON(output, insightsParser),
//     ]);
//   }

//   private parseJSON(output: AIMessage | string, parser: StructuredOutputParser<any>): any {
//     try {
//       // Extract text content from AIMessage if that's what we received
//       let text: string;
//       if (typeof output === 'string') {
//         text = output;
//       } else if (output instanceof AIMessage || (output && typeof output === 'object' && 'content' in output)) {
//         text = output.content as string;
//       } else {
//         console.error('Unexpected output type:', typeof output, output);
//         text = String(output);
//       }

//       // Clean the response - remove markdown code blocks if present
//       let cleaned = text.trim();
      
//       // Remove markdown code blocks
//       cleaned = cleaned.replace(/```json\s*/g, '');
//       cleaned = cleaned.replace(/```\s*/g, '');
      
//       // Remove any leading text before the JSON object
//       const jsonStart = cleaned.indexOf('{');
//       const jsonEnd = cleaned.lastIndexOf('}');
      
//       if (jsonStart !== -1 && jsonEnd !== -1) {
//         cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
//       }

//       // Fix common LLM JSON formatting issues
//       cleaned = this.fixMalformedJSON(cleaned);
      
//       // Try to parse the cleaned JSON
//       const parsed = JSON.parse(cleaned);
//       return parsed;
//     } catch (error) {
//       console.error('Failed to parse LLM response:', output);
//       console.error('Parse error:', error.message);
      
//       // Try the original parser as fallback
//       try {
//         // Extract content if it's an AIMessage
//         const text = typeof output === 'string' ? output : (output as AIMessage).content as string;
//         return parser.parse(text);
//       } catch (fallbackError) {
//         // Return a default structure if all parsing fails
//         console.error('Fallback parser also failed, returning defaults');
//         return this.getDefaultResponse(output);
//       }
//     }
//   }

//   private fixMalformedJSON(jsonStr: string): string {
//     try {
//       // First pass: Fix missing commas between array closing and next property
//       // Pattern: ]<newline>"propertyName": should be ],<newline>"propertyName":
//       jsonStr = jsonStr.replace(/\]\s*\n\s*"/g, '],\n"');
      
//       // Also fix: }<newline>"propertyName": should be },<newline>"propertyName":
//       jsonStr = jsonStr.replace(/\}\s*\n\s*"/g, '},\n"');

//       // Fix missing quotes in array elements
//       // Match array elements that start without quotes after [ or ,
//       jsonStr = jsonStr.replace(/(\[|\,)\s*\n\s*([A-Z][^"\[\]\{\},]*?)\s*(?=,|\])/g, (match, prefix, content) => {
//         // Only fix if it doesn't already start with a quote
//         if (!content.startsWith('"')) {
//           return `${prefix}\n"${content.trim()}"`;
//         }
//         return match;
//       });

//       // Fix lines in arrays that don't start or end with quotes
//       // This handles multi-line array elements
//       const lines = jsonStr.split('\n');
//       const fixed: string[] = [];
//       let inArray = false;
//       let arrayDepth = 0;

//       for (let i = 0; i < lines.length; i++) {
//         let line = lines[i];
//         const trimmed = line.trim();

//         // Track array depth
//         if (trimmed.includes('[')) {
//           arrayDepth += (trimmed.match(/\[/g) || []).length;
//           inArray = arrayDepth > 0;
//         }
//         if (trimmed.includes(']')) {
//           arrayDepth -= (trimmed.match(/\]/g) || []).length;
//           inArray = arrayDepth > 0;
//         }

//         // If we're in an array and the line doesn't start with " or end properly
//         if (inArray && trimmed.length > 0 && 
//             !trimmed.startsWith('"') && 
//             !trimmed.startsWith('[') && 
//             !trimmed.startsWith(']') &&
//             !trimmed.startsWith('{') &&
//             !trimmed.startsWith('}') &&
//             trimmed !== ',' &&
//             !/^\s*"[^"]*"\s*:/.test(trimmed)) { // Not a key-value pair
          
//           // Check if line ends with comma or array bracket
//           const hasComma = trimmed.endsWith(',');
//           const hasClosingBracket = trimmed.endsWith(']');
          
//           // Remove trailing comma or bracket temporarily
//           let content = trimmed;
//           if (hasComma) {
//             content = content.slice(0, -1).trim();
//           } else if (hasClosingBracket) {
//             content = content.slice(0, -1).trim();
//           }

//           // Add quotes if not present
//           if (!content.startsWith('"')) {
//             content = '"' + content;
//           }
//           if (!content.endsWith('"')) {
//             content = content + '"';
//           }

//           // Re-add comma or bracket
//           if (hasComma) {
//             content += ',';
//           } else if (hasClosingBracket) {
//             content += ']';
//           }

//           line = line.replace(trimmed, content);
//         }

//         fixed.push(line);
//       }

//       return fixed.join('\n');
//     } catch (error) {
//       console.error('Error fixing malformed JSON:', error.message);
//       return jsonStr; // Return original if fixing fails
//     }
//   }

//   private getDefaultResponse(output: any): any {
//     // Extract whatever we can from the output
//     console.warn('Using fallback default response due to parsing failure');
    
//     return {
//       insights: ['Unable to parse full insights from LLM response'],
//       trends: ['Data analysis in progress'],
//       anomalies: [],
//       recommendations: ['Review data quality and retry analysis'],
//       summary: 'Analysis could not be completed',
//       key_points: ['Parsing error occurred'],
//       data_quality: 'unknown',
//       record_count: 0,
//     };
//   }

//   async generateReport(params: {
//     recordId?: string;
//     filename?: string;
//     data?: string;
//     reportType?: string;
//   }): Promise<GeneratedReport> {
//     console.log('=== REPORT AGENT: Generating Report ===');
//     console.log('Params:', params);

//     // Get data from various sources
//     let data: string;
//     let sourceInfo: string;
//     let recordCount = 0;

//     if (params.data) {
//       data = params.data;
//       sourceInfo = 'Direct data input';
//     } else if (params.recordId) {
//       const record = await this.knowledgeBaseRepository.findOne({
//         where: { id: params.recordId },
//       });
//       if (!record) {
//         throw new NotFoundException(`Record with ID ${params.recordId} not found`);
//       }
//       data = record.content;
//       sourceInfo = record.filename || record.title;
//     } else if (params.filename) {
//       const record = await this.knowledgeBaseRepository.findOne({
//         where: { title: params.filename },
//       });
//       if (!record) {
//         throw new NotFoundException(`Record with filename ${params.filename} not found`);
//       }
//       data = record.content;
//       sourceInfo = record.filename || record.title;
//     } else {
//       throw new Error('Must provide either recordId, filename, or data');
//     }

//     // Count records (assume CSV format)
//     const lines = data.split('\n').filter(line => line.trim().length > 0);
//     recordCount = Math.max(0, lines.length - 1); // Subtract header

//     // Truncate data if too large for LLM context
//     const maxDataLength = 8000;
//     let truncatedData = data;
//     let wasTruncated = false;
    
//     if (data.length > maxDataLength) {
//       console.warn(`Data too large (${data.length} chars), truncating to ${maxDataLength} chars`);
//       truncatedData = data.substring(0, maxDataLength) + '\n...[data truncated]...';
//       wasTruncated = true;
//     }

//     try {
//       // Generate summary
//       console.log('Generating summary...');
//       const summaryResult = await this.summaryChain.invoke({ data: truncatedData });
//       console.log('Summary generated:', JSON.stringify(summaryResult, null, 2));

//       // Generate insights
//       console.log('Generating insights...');
//       const insightsResult = await this.insightsChain.invoke({
//         data: truncatedData,
//         summary: summaryResult.summary || '',
//       });
//       console.log('Insights generated:', JSON.stringify(insightsResult, null, 2));

//       // Build report sections with defensive checks
//       const sections: ReportSection[] = [
//         {
//           title: 'Executive Summary',
//           content: summaryResult.summary || 'Summary not available',
//           insights: Array.isArray(summaryResult.key_points) ? summaryResult.key_points : [],
//         },
//         {
//           title: 'Data Quality Assessment',
//           content: summaryResult.data_quality || 'Data quality assessment not available',
//         },
//         {
//           title: 'Key Insights',
//           content: 'Analysis of the dataset reveals the following insights:',
//           insights: Array.isArray(insightsResult.insights) ? insightsResult.insights : [],
//         },
//       ];

//       if (Array.isArray(insightsResult.trends) && insightsResult.trends.length > 0) {
//         sections.push({
//           title: 'Trends and Patterns',
//           content: 'The following trends were identified in the data:',
//           insights: insightsResult.trends,
//         });
//       }

//       if (Array.isArray(insightsResult.anomalies) && insightsResult.anomalies.length > 0) {
//         sections.push({
//           title: 'Anomalies and Outliers',
//           content: 'The following anomalies were detected:',
//           insights: insightsResult.anomalies,
//         });
//       }

//       if (wasTruncated) {
//         sections.push({
//           title: 'Note',
//           content: 'This analysis was performed on a sample of the data due to size constraints. For complete analysis, consider processing smaller data segments.',
//         });
//       }

//       // Build metadata
//       const metadata: ReportMetadata = {
//         title: `Data Analysis Report - ${sourceInfo}`,
//         generatedAt: new Date(),
//         dataSource: sourceInfo,
//         recordCount,
//         reportType: params.reportType || 'standard',
//       };

//       const report: GeneratedReport = {
//         metadata,
//         sections,
//         summary: summaryResult.summary || 'Summary not available',
//         recommendations: Array.isArray(insightsResult.recommendations) ? insightsResult.recommendations : [],
//       };

//       console.log('Report generated successfully');
//       return report;
//     } catch (error) {
//       console.error('Error generating report:', error);
//       console.error('Error stack:', error.stack);
      
//       // Return a basic report with error information
//       return this.generateFallbackReport(sourceInfo, recordCount, error.message);
//     }
//   }

//   private generateFallbackReport(
//     sourceInfo: string,
//     recordCount: number,
//     errorMessage: string
//   ): GeneratedReport {
//     console.warn('Generating fallback report due to error');
    
//     return {
//       metadata: {
//         title: `Data Analysis Report - ${sourceInfo}`,
//         generatedAt: new Date(),
//         dataSource: sourceInfo,
//         recordCount,
//         reportType: 'fallback',
//       },
//       sections: [
//         {
//           title: 'Report Generation Error',
//           content: 'An error occurred while generating the detailed analysis. Please review the data and try again.',
//         },
//         {
//           title: 'Basic Information',
//           content: `The dataset contains ${recordCount} records from ${sourceInfo}.`,
//         },
//       ],
//       summary: `Basic report for ${sourceInfo} with ${recordCount} records. Detailed analysis could not be completed.`,
//       recommendations: [
//         'Check data format and quality',
//         'Ensure Ollama service is running',
//         'Try with a smaller dataset',
//         'Review error logs for details',
//       ],
//     };
//   }

//   async createSummary(params: {
//     recordId?: string;
//     filename?: string;
//     data?: string;
//   }): Promise<any> {
//     console.log('=== REPORT AGENT: Creating Summary ===');

//     // Get data
//     let data: string;

//     if (params.data) {
//       data = params.data;
//     } else if (params.recordId) {
//       const record = await this.knowledgeBaseRepository.findOne({
//         where: { id: params.recordId },
//       });
//       if (!record) {
//         throw new NotFoundException(`Record with ID ${params.recordId} not found`);
//       }
//       data = record.content;
//     } else if (params.filename) {
//       const record = await this.knowledgeBaseRepository.findOne({
//         where: { title: params.filename },
//       });
//       if (!record) {
//         throw new NotFoundException(`Record with filename ${params.filename} not found`);
//       }
//       data = record.content;
//     } else {
//       throw new Error('Must provide either recordId, filename, or data');
//     }

//     // Generate summary
//     const summaryResult = await this.summaryChain.invoke({ data });
//     return summaryResult;
//   }

//   async exportPdf(report: GeneratedReport): Promise<string> {
//     console.log('=== REPORT AGENT: Exporting PDF ===');

//     // Generate HTML content for PDF
//     const html = this.generateReportHtml(report);

//     // In a real implementation, you would use a library like puppeteer or pdfkit
//     // For now, we'll return the HTML as a placeholder
//     console.log('PDF export would be generated here');
//     console.log('Report title:', report.metadata.title);

//     return html;
//   }

//   private generateReportHtml(report: GeneratedReport): string {
//     const sectionsHtml = report.sections
//       .map(section => {
//         const insightsHtml = section.insights
//           ? `<ul>${section.insights.map(insight => `<li>${insight}</li>`).join('')}</ul>`
//           : '';

//         return `
//         <div class="section">
//           <h2>${section.title}</h2>
//           <p>${section.content}</p>
//           ${insightsHtml}
//         </div>
//       `;
//       })
//       .join('');

//     const recommendationsHtml = report.recommendations
//       ? `
//       <div class="section">
//         <h2>Recommendations</h2>
//         <ul>${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}</ul>
//       </div>
//     `
//       : '';

//     return `
// <!DOCTYPE html>
// <html>
// <head>
//   <meta charset="UTF-8">
//   <title>${report.metadata.title}</title>
//   <style>
//     body {
//       font-family: Arial, sans-serif;
//       line-height: 1.6;
//       color: #333;
//       max-width: 800px;
//       margin: 0 auto;
//       padding: 20px;
//     }
//     h1 {
//       color: #2c3e50;
//       border-bottom: 3px solid #3498db;
//       padding-bottom: 10px;
//     }
//     h2 {
//       color: #34495e;
//       margin-top: 30px;
//       border-bottom: 1px solid #ecf0f1;
//       padding-bottom: 5px;
//     }
//     .metadata {
//       background: #ecf0f1;
//       padding: 15px;
//       border-radius: 5px;
//       margin-bottom: 20px;
//     }
//     .metadata p {
//       margin: 5px 0;
//     }
//     .section {
//       margin-bottom: 30px;
//     }
//     ul {
//       padding-left: 20px;
//     }
//     li {
//       margin-bottom: 8px;
//     }
//   </style>
// </head>
// <body>
//   <h1>${report.metadata.title}</h1>
  
//   <div class="metadata">
//     <p><strong>Generated:</strong> ${report.metadata.generatedAt.toLocaleString()}</p>
//     <p><strong>Data Source:</strong> ${report.metadata.dataSource}</p>
//     <p><strong>Record Count:</strong> ${report.metadata.recordCount}</p>
//     <p><strong>Report Type:</strong> ${report.metadata.reportType}</p>
//   </div>

//   ${sectionsHtml}
//   ${recommendationsHtml}
// </body>
// </html>
//     `;
//   }

//   async formatReportAsMarkdown(report: GeneratedReport): Promise<string> {
//     let markdown = `# ${report.metadata.title}\n\n`;
//     markdown += `**Generated:** ${report.metadata.generatedAt.toLocaleString()}\n`;
//     markdown += `**Data Source:** ${report.metadata.dataSource}\n`;
//     markdown += `**Record Count:** ${report.metadata.recordCount}\n`;
//     markdown += `**Report Type:** ${report.metadata.reportType}\n\n`;
//     markdown += `---\n\n`;

//     for (const section of report.sections) {
//       markdown += `## ${section.title}\n\n`;
//       markdown += `${section.content}\n\n`;

//       if (section.insights && section.insights.length > 0) {
//         section.insights.forEach(insight => {
//           markdown += `- ${insight}\n`;
//         });
//         markdown += '\n';
//       }
//     }

//     if (report.recommendations && report.recommendations.length > 0) {
//       markdown += `## Recommendations\n\n`;
//       report.recommendations.forEach(rec => {
//         markdown += `- ${rec}\n`;
//       });
//       markdown += '\n';
//     }

//     return markdown;
//   }

//   async formatReportAsJson(report: GeneratedReport): Promise<any> {
//     return {
//       metadata: report.metadata,
//       sections: report.sections,
//       summary: report.summary,
//       recommendations: report.recommendations,
//     };
//   }

//   // Convenience method for quick statistics
//   async getDataStatistics(data: string): Promise<any> {
//     const lines = data.split('\n').filter(line => line.trim().length > 0);
//     const headers = lines[0]?.split(',') || [];
//     const recordCount = lines.length - 1;

//     // Count invalid entries
//     const invalidCounts = {
//       emails: 0,
//       dates: 0,
//       ages: 0,
//       phones: 0,
//       amounts: 0,
//     };

//     lines.slice(1).forEach(line => {
//       if (line.includes('[INVALID_EMAIL]')) invalidCounts.emails++;
//       if (line.includes('[INVALID_DATE]')) invalidCounts.dates++;
//       if (line.includes('[INVALID_AGE]')) invalidCounts.ages++;
//       if (line.includes('[INVALID_PHONE]')) invalidCounts.phones++;
//       if (line.includes('[INVALID_AMOUNT]')) invalidCounts.amounts++;
//     });

//     return {
//       totalRecords: recordCount,
//       columns: headers,
//       columnCount: headers.length,
//       invalidCounts,
//       hasInvalidData: Object.values(invalidCounts).some(count => count > 0),
//     };
//   }
// }
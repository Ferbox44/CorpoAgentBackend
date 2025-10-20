import { Injectable } from '@nestjs/common';
import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { DataAgentService } from '../data_agent/data_agent.service';
import { ReportAgentService } from '../report_agent/report_agent.service';

interface AgentTask {
  agent: string;
  action: string;
  params: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

interface WorkflowPlan {
  tasks: AgentTask[];
  reasoning: string;
}

@Injectable()
export class OrchestratorService {
  private readonly model: ChatOllama;
  private plannerChain: RunnableSequence;

  constructor(
    private readonly dataAgentService: DataAgentService,
    private readonly reportAgentService: ReportAgentService,
  ) {
    this.model = new ChatOllama({
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
      temperature: 0.3,
    });

    this.setupPlannerChain();
  }

  private setupPlannerChain() {
    const outputSchema = z.object({
      tasks: z.array(
        z.object({
          agent: z.enum(['data', 'report', 'automation']),
          action: z.string(),
          params: z.record(z.any()),
          dependencies: z.array(z.number()).optional(),
        })
      ),
      reasoning: z.string(),
    });

    const parser = StructuredOutputParser.fromZodSchema(outputSchema);
    const formatInstructions = parser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const promptTemplate = `
You are an orchestrator agent that coordinates multiple specialized agents to complete user requests.

AVAILABLE AGENTS:
1. DATA AGENT: Handles data processing, cleaning, transformation, validation, and storage
   - Actions: 
     * get_by_id: Retrieve a processed record by its ID (use when ID is known)
     * get_by_filename: Retrieve a processed record by its filename (use when filename is provided)
     * process_data: Process raw data (clean, transform, validate) and save to database (use ONLY when new data needs processing)
   
2. REPORT AGENT: Creates reports from processed data
   - Actions: 
     * generate_report: Generate a comprehensive report with insights and recommendations
     * create_summary: Create a quick summary of the data
     * export_pdf: Export report as PDF (HTML)
     * export_markdown: Export report as Markdown
     * export_json: Export report as JSON
     * get_statistics: Get basic statistics about the data

TASK PLANNING RULES:
- If user mentions an EXISTING file/record in the database, use get_by_filename or get_by_id to RETRIEVE it
- Only use process_data when user is uploading NEW data or explicitly asks to process/re-process data
- Reports can be generated directly from existing records using recordId or filename
- Use dependencies array to specify task order (by index, 0-based)
- When a task depends on another task's result, use placeholder syntax: {{task.INDEX.FIELD}}
- Example: If task 0 retrieves data, task 1 can use {{task.0.id}} to reference the record ID

PARAMETER PLACEHOLDER SYNTAX:
- Use {{task.0.id}} to reference the "id" field from task 0's result
- Use {{task.0.filename}} to reference the "filename" field from task 0's result
- Use {{task.1.recordId}} to reference the "recordId" field from task 1's result

EXAMPLES:
- "Create report from employees.csv" → 
  Task 0: get_by_filename with filename="employees.csv"
  Task 1: generate_report with recordId="{{task.0.id}}"
  
- "Generate report for record abc-123" → 
  Task 0: get_by_id with id="abc-123"
  Task 1: generate_report with recordId="{{task.0.id}}"
  
- "Process this new data and report" → 
  Task 0: process_data with data from context
  Task 1: generate_report with recordId="{{task.0.recordId}}"

USER REQUEST:
{request}

CONTEXT (if available):
{context}

Plan the workflow as a sequence of tasks. Use this exact JSON format:
${formatInstructions}

Provide your workflow plan:`;

    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    this.plannerChain = RunnableSequence.from([prompt, this.model, parser]);
  }

  async processRequest(request: string, context?: any): Promise<any> {
    console.log('=== ORCHESTRATOR: Processing Request ===');
    console.log('Request:', request);

    const plan = await this.planWorkflow(request, context);
    console.log('Workflow plan:', JSON.stringify(plan, null, 2));

    const results = await this.executeWorkflow(plan, context);

    return {
      plan,
      results,
      summary: this.summarizeResults(results),
    };
  }

  private async planWorkflow(
    request: string,
    context?: any
  ): Promise<WorkflowPlan> {
    try {
      const contextStr = context ? JSON.stringify(context) : 'None';
      const result = await this.plannerChain.invoke({
        request,
        context: contextStr,
      });

      const tasks: AgentTask[] = result.tasks.map((task: any) => ({
        agent: task.agent,
        action: task.action,
        params: task.params,
        status: 'pending' as const,
        dependencies: task.dependencies || [],
      }));

      return {
        tasks,
        reasoning: result.reasoning,
      };
    } catch (error) {
      console.error('Planning error:', error);
      throw new Error(`Failed to plan workflow: ${error.message}`);
    }
  }

  private async executeWorkflow(plan: WorkflowPlan, context?: any): Promise<any[]> {
    console.log('=== ORCHESTRATOR: Executing Workflow ===');
    const results: any[] = [];

    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i];
      console.log(`\nExecuting task ${i + 1}/${plan.tasks.length}:`, task.action);

      const deps = (task as any).dependencies || [];
      for (const depIdx of deps) {
        if (results[depIdx]?.error) {
          task.status = 'failed';
          task.error = `Dependency task ${depIdx} failed`;
          results.push({ error: task.error });
          continue;
        }
      }

      task.status = 'running';

      try {
        const result = await this.executeTask(task, results, context);
        task.status = 'completed';
        task.result = result;
        results.push(result);
        console.log(`Task ${i + 1} completed successfully`);
      } catch (error) {
        task.status = 'failed';
        task.error = error.message;
        results.push({ error: error.message });
        console.error(`Task ${i + 1} failed:`, error.message);
        
        if (task.agent === 'data') {
          throw new Error(`Critical task failed: ${error.message}`);
        }
      }
    }

    return results;
  }

  private async executeTask(task: AgentTask, previousResults: any[], context?: any): Promise<any> {
    let params = this.enrichParams(task.params, previousResults);
    
    if (context) {
      console.log('Injecting context into task params...');
      
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string') {
          const match = value.match(/(?:\{\{|\$\{)context\.(\w+)\}\}/);
          if (match) {
            const [, field] = match;
            if (context[field] !== undefined) {
              console.log(`Replacing ${value} with context.${field}`);
              params[key] = context[field];
            }
          }
        }
      }
      
      if (context.fileData && !params.fileData && !params.data) {
        console.log('Auto-injecting fileData from context');
        params.fileData = context.fileData;
      }
      
      if (context.filename && !params.filename) {
        console.log('Auto-injecting filename from context');
        params.filename = context.filename;
      }
      
      params._context = context;
    }

    switch (task.agent) {
      case 'data':
        return this.executeDataAgentTask(task.action, params);
      
      case 'report':
        return this.executeReportAgentTask(task.action, params);
      
      case 'automation':
        return this.executeAutomationAgentTask(task.action, params);
      
      default:
        throw new Error(`Unknown agent: ${task.agent}`);
    }
  }

  private enrichParams(params: any, previousResults: any[]): any {
    const enriched = { ...params };
    
    for (const [key, value] of Object.entries(enriched)) {
      if (typeof value === 'string') {
        const match = value.match(/(?:\{\{|\$\{)task\.(\d+)\.(\w+)\}\}/);
        if (match) {
          const [, taskIdx, field] = match;
          const taskResult = previousResults[parseInt(taskIdx)];
          if (taskResult && taskResult[field] !== undefined) {
            console.log(`Replacing ${value} with result from task ${taskIdx}.${field}`);
            enriched[key] = taskResult[field];
          }
        }
      }
    }
    
    return enriched;
  }

  private async executeDataAgentTask(action: string, params: any): Promise<any> {
    console.log('Executing DATA agent action:', action, params);
    
    switch (action) {
      case 'analyze_data':
        return this.dataAgentService.analyzeData(params.data);
      
      case 'get_by_id':
        return this.dataAgentService.getRecordById(params.id);
      
      case 'get_by_filename':
        return this.dataAgentService.findRecordByFilename(params.filename);
      
      case 'process_data':
      case 'upload_and_process':
        const context = params._context || {};
        const data = params.fileData || params.data || context.fileData;
        const filename = params.filename || context.filename || 'uploaded_file.csv';
        const tags = params.tags;
        
        if (!data) {
          throw new Error('No data provided for processing');
        }
        
        console.log('Processing data with filename:', filename);
        console.log('Data length:', data.length);
        
        return this.dataAgentService.analyzeAndProcess(data, filename, tags);
      
      default:
        throw new Error(`Unknown data agent action: ${action}`);
    }
  }

  private async executeReportAgentTask(action: string, params: any): Promise<any> {
    console.log('Executing REPORT agent action:', action, params);
    
    switch (action) {
      case 'generate_report':
        return this.reportAgentService.generateReport({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
          reportType: params.reportType || 'standard',
        });
      
      case 'create_summary':
        return this.reportAgentService.createSummary({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
        });
      
      case 'export_pdf':
        const pdfReport = await this.reportAgentService.generateReport({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
          reportType: params.reportType,
        });
        return this.reportAgentService.exportPdf(pdfReport);
      
      case 'export_markdown':
        const mdReport = await this.reportAgentService.generateReport({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
          reportType: params.reportType,
        });
        return this.reportAgentService.formatReportAsMarkdown(mdReport);
      
      case 'export_json':
        const jsonReport = await this.reportAgentService.generateReport({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
          reportType: params.reportType,
        });
        return this.reportAgentService.formatReportAsJson(jsonReport);
      
      case 'get_statistics':
        return this.reportAgentService.getDataStatistics(params.data);
      
      default:
        throw new Error(`Unknown report agent action: ${action}`);
    }
  }

  private async executeAutomationAgentTask(action: string, params: any): Promise<any> {
    console.log('Executing AUTOMATION agent action:', action, params);
    
    // Placeholder - implement when AutomationAgentService is ready
    return {
      message: `Automation agent task '${action}' executed (placeholder)`,
      params,
    };
  }

  private summarizeResults(results: any[]): string {
    const successful = results.filter(r => !r.error).length;
    const failed = results.filter(r => r.error).length;
    
    return `Workflow completed: ${successful} tasks successful, ${failed} tasks failed`;
  }

  async processAndReport(filename: string, recipientEmail: string): Promise<any> {
    const request = `
      1. Get the processed data file named "${filename}"
      2. Generate a comprehensive report from this data with insights and recommendations
      3. Send the report to ${recipientEmail}
    `;
    
    return this.processRequest(request, { filename, recipientEmail });
  }

  async processFileUpload(file: Express.Multer.File, request: string): Promise<any> {
    console.log('=== ORCHESTRATOR: Processing File Upload ===');
    console.log('Filename:', file.originalname);
    console.log('Request:', request);

    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'unknown';
    let text = '';

    try {
      if (ext === 'csv' || ext === 'txt') {
        text = file.buffer.toString('utf8');
      } else if (ext === 'pdf') {
        const pdfExtractText = require('pdf-parse');
        const pdfData = await pdfExtractText(file.buffer);
        text = pdfData.text;
      } else {
        text = file.buffer.toString('utf8');
      }
    } catch (error) {
      throw new Error(`Failed to extract text from file: ${error.message}`);
    }

    if (!text || text.trim().length === 0) {
      throw new Error('File appears to be empty or could not be read');
    }

    const context = {
      filename: file.originalname,
      fileSize: file.size,
      fileType: ext,
      fileData: text,
    };

    const enhancedRequest = `
      A file named "${file.originalname}" has been uploaded and extracted.
      Task: ${request}
      
      The file data is ready to be processed and saved to the database.
    `;

    return this.processRequest(enhancedRequest, context);
  }
}
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { KnowledgeBase } from '../../entities/knowledge_base.entity';
import { AIMessage } from '@langchain/core/messages';

interface Tool {
  name: string;
  description: string;
  call: (data: string) => string;
}

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

export interface ReportMetadata {
  title: string;
  generatedAt: Date;
  dataSource: string;
  recordCount: number;
  reportType: string;
}

export interface ReportSection {
  title: string;
  content: string;
  insights?: string[];
}

export interface GeneratedReport {
  metadata: ReportMetadata;
  sections: ReportSection[];
  summary: string;
  recommendations?: string[];
}

function parseCSV(data: string): { headers: string[], rows: string[][] } {
  // Handle both actual newlines and literal \n strings
  const normalizedData = data.replace(/\\n/g, '\n');
  const lines = normalizedData.trim().split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length < 2) {
    throw new Error('Invalid CSV: needs at least header and one row');
  }
  
  // Parse a single CSV line handling quotes
  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add last field
    result.push(current.trim());
    return result;
  }
  
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const headerCount = headers.length;
  
  const rows = lines.slice(1).map((line, idx) => {
    const cells = parseCSVLine(line);
    
    // Pad row if it has fewer cells than headers
    while (cells.length < headerCount) {
      console.warn(`Row ${idx + 2} has ${cells.length} cells but expected ${headerCount}. Padding with empty string.`);
      cells.push('');
    }
    
    // Truncate row if it has more cells than headers
    if (cells.length > headerCount) {
      console.warn(`Row ${idx + 2} has ${cells.length} cells but expected ${headerCount}. Truncating from ${cells.length} to ${headerCount}.`);
      console.warn(`Extra values: ${cells.slice(headerCount).join(', ')}`);
      return cells.slice(0, headerCount);
    }
    
    return cells;
  });
  
  return { headers, rows };
}

function reconstructCSV(headers: string[], rows: string[][]): string {
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

@Injectable()
export class UniAgentService {
  private readonly model: ChatGoogleGenerativeAI;
  private plannerChain: RunnableSequence;
  private dataAnalysisChain: RunnableSequence;
  private summaryChain: RunnableSequence;
  private insightsChain: RunnableSequence;
  private tools: Tool[];

  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
  ) {
    // Initialize Google Gemini model
    this.model = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      temperature: 0.3,
      apiKey: process.env.GOOGLE_API_KEY || 'your-api-key-here',
    });
    console.log('Api key used: ', process.env.GOOGLE_API_KEY);

    this.setupChains();
    this.setupTools();
  }

  private setupChains() {
    // Planner chain for orchestrating tasks
    const plannerSchema = z.object({
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

    const plannerParser = StructuredOutputParser.fromZodSchema(plannerSchema);
    const plannerFormatInstructions = plannerParser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const plannerPromptTemplate = `
You are a unified agent that can handle data processing, analysis, and report generation.

AVAILABLE CAPABILITIES:
1. DATA PROCESSING: Clean, transform, validate, and store data
   - Actions: 
     * get_by_id: Retrieve a processed record by its ID
     * get_by_filename: Retrieve a processed record by its filename
     * process_data: Process raw data (clean, transform, validate) and save to database
   
2. REPORT GENERATION: Create comprehensive reports from processed data
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
- For export tasks that depend on generate_report, use the SAME parameters as the generate_report task

CRITICAL RULES FOR EXPORT TASKS:
- export_pdf, export_markdown, export_json should use the SAME parameters as the generate_report task they depend on
- Do NOT use {{task.X.reportId}} - this field does not exist
- Use the same recordId, filename, or data parameters that were used in the generate_report task

EXAMPLES:
- "Create report from employees.csv" → 
  Task 0: get_by_filename with filename="employees.csv"
  Task 1: generate_report with recordId="{{task.0.id}}"
  
- "Generate report for record abc-123" → 
  Task 0: get_by_id with id="abc-123"
  Task 1: generate_report with recordId="{{task.0.id}}"
  
- "Process this new data and report" → 
  Task 0: process_data (data will be auto-injected from context)
  Task 1: generate_report with recordId="{{task.0.recordId}}"

- "Generate report from employees.csv and export to PDF" →
  Task 0: get_by_filename with filename="employees.csv"
  Task 1: generate_report with recordId="{{task.0.id}}"
  Task 2: export_pdf with recordId="{{task.0.id}}" (SAME as task 1)

USER REQUEST:
{request}

CONTEXT (if available):
{context}

Plan the workflow as a sequence of tasks. Use this exact JSON format:
${plannerFormatInstructions}

Provide your workflow plan:`;

    const plannerPrompt = ChatPromptTemplate.fromTemplate(plannerPromptTemplate);
    this.plannerChain = RunnableSequence.from([plannerPrompt, this.model, plannerParser]);

    // Data analysis chain
    const dataAnalysisSchema = z.object({
      needs_cleaning: z.boolean(),
      needs_transformation: z.boolean(),
      needs_validation: z.boolean(),
      raw_text_allowed: z.boolean().optional(),
      explanation: z.string(),
    });

    const dataAnalysisParser = StructuredOutputParser.fromZodSchema(dataAnalysisSchema);
    const dataAnalysisFormatInstructions = dataAnalysisParser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const dataAnalysisPromptTemplate = `
You are a data quality analyst. Analyze the provided data and determine what processing is needed.

DEFINITIONS:
- needs_cleaning: true if data contains NULL, N/A, empty values, or needs whitespace normalization
- needs_transformation: true if dates need standardization (to YYYY-MM-DD), emails need lowercase, phone numbers need formatting, or currency has commas
- needs_validation: true if you need to check for invalid emails (missing @), ages outside 0-120, invalid dates, or amounts outside reasonable ranges

RULES:
- If the data is NOT tabular/CSV format, set raw_text_allowed=true and all other flags to false
- If the data IS tabular (has rows and columns), analyze what processing it needs
- Look for patterns like: NULL values, inconsistent date formats (MM/DD/YYYY vs YYYY-MM-DD), mixed case emails, unformatted phone numbers
- Check if ages contain text instead of numbers, if emails are missing @, if dates are malformed

Use this exact JSON format:
${dataAnalysisFormatInstructions}

Data to analyze:
{data}

Provide your analysis:`;

    const dataAnalysisPrompt = ChatPromptTemplate.fromTemplate(dataAnalysisPromptTemplate);
    this.dataAnalysisChain = RunnableSequence.from([dataAnalysisPrompt, this.model, dataAnalysisParser]);

    // Summary chain
    const summarySchema = z.object({
      summary: z.string(),
      key_points: z.array(z.string()),
      data_quality: z.string(),
      record_count: z.number(),
    });

    const summaryParser = StructuredOutputParser.fromZodSchema(summarySchema);
    const summaryFormatInstructions = summaryParser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const summaryPromptTemplate = `
You are a data analyst creating concise summaries of processed datasets.

Analyze the following data and provide:
1. A brief summary (2-3 sentences) of what the data represents
2. Key points or notable patterns (3-5 bullet points)
3. Assessment of data quality (good/fair/poor with brief explanation)
4. Count of valid records

DATA:
{data}

CRITICAL JSON FORMATTING RULES:
- Respond with ONLY valid JSON - no markdown, no code blocks, no explanatory text
- ALL strings in arrays MUST be wrapped in double quotes: ["item1", "item2"]
- Do NOT write: [item1, item2] or ["item1, item2] - both are invalid
- Every array element must be a complete quoted string
- Do not wrap response in \`\`\`json or any other markers
- Ensure all commas and brackets are properly placed

Use this exact JSON format:
${summaryFormatInstructions}

Respond with only the JSON object:`;

    const summaryPrompt = ChatPromptTemplate.fromTemplate(summaryPromptTemplate);
    this.summaryChain = RunnableSequence.from([
      summaryPrompt,
      this.model,
      (output: AIMessage | string) => this.parseJSON(output, summaryParser),
    ]);

    // Insights chain
    const insightsSchema = z.object({
      insights: z.array(z.string()),
      trends: z.array(z.string()),
      anomalies: z.array(z.string()),
      recommendations: z.array(z.string()),
    });

    const insightsParser = StructuredOutputParser.fromZodSchema(insightsSchema);
    const insightsFormatInstructions = insightsParser
      .getFormatInstructions()
      .replace(/{/g, '{{')
      .replace(/}/g, '}}');

    const insightsPromptTemplate = `
You are a data analyst providing deep insights from processed data.

Analyze the data and identify:
1. Key insights (3-5 meaningful observations)
2. Trends or patterns (2-4 trends)
3. Anomalies or outliers (if any, 0-3)
4. Actionable recommendations (2-4 suggestions)

DATA:
{data}

SUMMARY CONTEXT:
{summary}

CRITICAL JSON FORMATTING RULES:
- Respond with ONLY valid JSON - no markdown, no code blocks, no explanatory text
- ALL strings in arrays MUST be wrapped in double quotes: ["item1", "item2"]
- Do NOT write: [item1, item2] or ["item1, item2] - both are invalid
- Every array element must be a complete quoted string on one line
- Do not wrap response in \`\`\`json or any other markers
- Ensure all commas and brackets are properly placed

Use this exact JSON format:
${insightsFormatInstructions}

Respond with only the JSON object:`;

    const insightsPrompt = ChatPromptTemplate.fromTemplate(insightsPromptTemplate);
    this.insightsChain = RunnableSequence.from([
      insightsPrompt,
      this.model,
      (output: AIMessage | string) => this.parseJSON(output, insightsParser),
    ]);
  }

  private setupTools() {
    this.tools = [
      {
        name: "clean",
        description: "Removes null values, duplicates, and corrects formatting errors. Handles multiple data separators and replaces empty fields with 'Unknown'.",
        call: (data: string): string => {
          if (!data || typeof data !== 'string') return '';
          
          try {
            const { headers, rows } = parseCSV(data);
            
            const cleanedRows = rows.map(row => {
              return row.map(cell => {
                // Replace null/empty patterns
                const nullPatterns = /^(NULL|N\/A|null|na|n\/a|PENDING|TBD|undefined|nil|none|--|)$/gi;
                if (nullPatterns.test(cell)) {
                  return 'Unknown';
                }
                // Normalize whitespace
                return cell.replace(/\s+/g, ' ').trim();
              });
            });
            
            return reconstructCSV(headers, cleanedRows);
          } catch (e) {
            console.error('Clean tool CSV parsing failed:', e.message);
            // Fallback to simple cleaning if CSV parsing fails
            let cleaned = data;
            cleaned = cleaned.replace(/\b(NULL|N\/A|null|na|n\/a|PENDING|TBD|undefined|nil|none|--)\b/gi, 'Unknown');
            cleaned = cleaned.replace(/\s+/g, ' ').trim();
            return cleaned;
          }
        },
      },
      {
        name: "transform",
        description: "Standardizes date formats (to ISO 8601), phone numbers, emails, currency values, and common data types.",
        call: (data: string): string => {
          if (!data || typeof data !== 'string') return '';
          
          try {
            const { headers, rows } = parseCSV(data);
            
            const transformedRows = rows.map(row => {
              return row.map((cell, idx) => {
                // Safety check: ensure header exists for this index
                if (idx >= headers.length) {
                  console.warn(`Column index ${idx} exceeds header count ${headers.length}`);
                  return cell;
                }
                
                const header = headers[idx] || '';
                
                // Transform dates
                if (header.includes('date') || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cell)) {
                  // MM/DD/YYYY to YYYY-MM-DD
                  cell = cell.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (match, m, d, y) => {
                    const month = m.padStart(2, '0');
                    const day = d.padStart(2, '0');
                    if (parseInt(month) > 12 || parseInt(day) > 31) return match;
                    return `${y}-${month}-${day}`;
                  });
                  
                  // DD-MM-YYYY to YYYY-MM-DD
                  cell = cell.replace(/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (match, d, m, y) => {
                    const month = m.padStart(2, '0');
                    const day = d.padStart(2, '0');
                    if (parseInt(month) > 12 || parseInt(day) > 31) return match;
                    return `${y}-${month}-${day}`;
                  });
                  
                  // YYYY/MM/DD to YYYY-MM-DD
                  cell = cell.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (match, y, m, d) => {
                    const month = m.padStart(2, '0');
                    const day = d.padStart(2, '0');
                    if (parseInt(month) > 12 || parseInt(day) > 31) return match;
                    return `${y}-${month}-${day}`;
                  });
                }
                
                // Transform emails to lowercase
                if (header.includes('email') || cell.includes('@')) {
                  const validEmailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                  if (validEmailPattern.test(cell)) {
                    cell = cell.toLowerCase();
                  }
                }
                
                // Transform phone numbers
                if (header.includes('phone') || /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(cell)) {
                  cell = cell.replace(/\+?1?[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/, '$1-$2-$3');
                }
                
                // Transform currency - be more specific to avoid breaking CSV structure
                if (header.includes('salary') || header.includes('price') || header.includes('amount')) {
                  // Remove commas from currency values (e.g., 75,000 → 75000)
                  cell = cell.replace(/^(\d{1,3}(?:,\d{3})+)$/, (match) => {
                    return match.replace(/,/g, '');
                  });
                  // Also handle with dollar sign: $75,000 → 75000
                  cell = cell.replace(/^\$(\d{1,3}(?:,\d{3})+(?:\.\d{2})?)$/, (match, num) => {
                    return num.replace(/,/g, '');
                  });
                }
                
                return cell;
              });
            });
            
            return reconstructCSV(headers, transformedRows);
          } catch (e) {
            console.error('Transform tool CSV parsing failed:', e.message);
            // Fallback to regex-based transformation
            let transformed = data;
            transformed = transformed.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (match, m, d, y) => {
              return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            });
            transformed = transformed.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, (m) => m.toLowerCase());
            return transformed;
          }
        },
      },
      {
        name: "validate",
        description: "Validates emails, dates, ages, and numeric ranges based on column context. Marks invalid entries with [INVALID_*] tags.",
        call: (data: string): string => {
          if (!data || typeof data !== 'string') return '';
          
          try {
            const { headers, rows } = parseCSV(data);
            
            const validatedRows = rows.map(row => {
              return row.map((cell, idx) => {
                // Safety check: ensure header exists for this index
                if (idx >= headers.length) {
                  console.warn(`Column index ${idx} exceeds header count ${headers.length}`);
                  return cell;
                }
                
                const header = headers[idx] || '';
                
                // Validate email columns - ONLY in email columns
                if (header === 'email' || header.includes('email')) {
                  const validEmailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
                  if (!validEmailPattern.test(cell) && cell.toLowerCase() !== 'unknown') {
                    return '[INVALID_EMAIL]';
                  }
                }
                
                // Validate age columns - ONLY in age columns
                if (header === 'age' || header.includes('age')) {
                  // Check if it's not a valid number and not 'Unknown'
                  if (!/^\d+$/.test(cell) && cell.toLowerCase() !== 'unknown') {
                    return '[INVALID_AGE]';
                  }
                  // Check if numeric age is out of range
                  if (/^\d+$/.test(cell)) {
                    const age = parseInt(cell);
                    if (age < 0 || age > 120) {
                      return '[INVALID_AGE]';
                    }
                  }
                }
                
                // Validate date columns - ONLY in date columns
                if (header === 'date' || header.includes('date')) {
                  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
                  const match = cell.match(datePattern);
                  if (match && cell.toLowerCase() !== 'unknown') {
                    const [, y, m, d] = match;
                    const year = parseInt(y);
                    const month = parseInt(m);
                    const day = parseInt(d);
                    
                    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) {
                      return '[INVALID_DATE]';
                    }
                    if (month === 2 && day > 29) return '[INVALID_DATE]';
                    if ([4, 6, 9, 11].includes(month) && day > 30) return '[INVALID_DATE]';
                  } else if (!match && cell.toLowerCase() !== 'unknown' && /\d/.test(cell)) {
                    // Date column has data but not in correct format
                    return '[INVALID_DATE]';
                  }
                }
                
                // Validate phone columns - ONLY in phone columns
                if (header === 'phone' || header.includes('phone')) {
                  const phonePattern = /^(\d{3})-(\d{3})-(\d{4})$/;
                  const match = cell.match(phonePattern);
                  if (match) {
                    const [, area] = match;
                    if (area[0] === '0' || area[0] === '1') {
                      return '[INVALID_PHONE]';
                    }
                  } else if (cell.toLowerCase() !== 'unknown' && /\d/.test(cell)) {
                    return '[INVALID_PHONE]';
                  }
                }
                
                // Validate salary/amount columns - ONLY in these columns
                if (header === 'salary' || header === 'amount' || header === 'price' || 
                    header.includes('salary') || header.includes('amount') || header.includes('price')) {
                  if (/^\d+(\.\d{3})?$/.test(cell)) {
                    return '[INVALID_AMOUNT]';
                  }
                }
                
                return cell;
              });
            });
            
            return reconstructCSV(headers, validatedRows);
          } catch (e) {
            console.error('Validate tool CSV parsing failed:', e.message);
            // If CSV parsing fails, return original data
            return data;
          }
        },
      },
      {
        name: "deduplicate",
        description: "Removes duplicate rows from the dataset while preserving the header.",
        call: (data: string): string => {
          if (!data || typeof data !== 'string') return '';
          
          try {
            const { headers, rows } = parseCSV(data);
            
            const uniqueRows: string[][] = [];
            const seen = new Set<string>();
            
            for (const row of rows) {
              const rowKey = row.join('|');
              if (!seen.has(rowKey)) {
                seen.add(rowKey);
                uniqueRows.push(row);
              }
            }
            
            return reconstructCSV(headers, uniqueRows);
          } catch (e) {
            console.error('Deduplicate tool CSV parsing failed:', e.message);
            const lines = data.split('\n');
            const uniqueLines = [...new Set(lines.map(line => line.trim()))].filter(line => line.length > 0);
            return uniqueLines.join('\n');
          }
        },
      },
      {
        name: "normalize",
        description: "Normalizes text casing, state codes, and whitespace consistently across all fields.",
        call: (data: string): string => {
          if (!data || typeof data !== 'string') return '';
          
          try {
            const { headers, rows } = parseCSV(data);
            
            const normalizedRows = rows.map(row => {
              return row.map((cell, idx) => {
                // Safety check: ensure header exists for this index
                if (idx >= headers.length) {
                  console.warn(`Column index ${idx} exceeds header count ${headers.length}`);
                  return cell;
                }
                
                const header = headers[idx] || '';
                
                // Normalize name fields to Title Case
                if (header.includes('name')) {
                  cell = cell.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
                }
                
                // Normalize state codes
                if (header.includes('state')) {
                  const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
                  if (states.includes(cell.toUpperCase())) {
                    cell = cell.toUpperCase();
                  }
                }
                
                return cell.trim();
              });
            });
            
            return reconstructCSV(headers, normalizedRows);
          } catch (e) {
            console.error('Normalize tool CSV parsing failed:', e.message);
            return data.trim();
          }
        },
      }
    ];
  }

  private parseJSON(output: AIMessage | string, parser: StructuredOutputParser<any>): any {
    try {
      // Extract text content from AIMessage if that's what we received
      let text: string;
      if (typeof output === 'string') {
        text = output;
      } else if (output instanceof AIMessage || (output && typeof output === 'object' && 'content' in output)) {
        text = output.content as string;
      } else {
        console.error('Unexpected output type:', typeof output, output);
        text = String(output);
      }

      // Clean the response - remove markdown code blocks if present
      let cleaned = text.trim();
      
      // Remove markdown code blocks
      cleaned = cleaned.replace(/```json\s*/g, '');
      cleaned = cleaned.replace(/```\s*/g, '');
      
      // Remove any leading text before the JSON object
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      }

      // Fix common LLM JSON formatting issues
      cleaned = this.fixMalformedJSON(cleaned);
      
      // Try to parse the cleaned JSON
      const parsed = JSON.parse(cleaned);
      return parsed;
    } catch (error) {
      console.error('Failed to parse LLM response:', output);
      console.error('Parse error:', error.message);
      
      // Try the original parser as fallback
      try {
        // Extract content if it's an AIMessage
        const text = typeof output === 'string' ? output : (output as AIMessage).content as string;
        return parser.parse(text);
      } catch (fallbackError) {
        // Return a default structure if all parsing fails
        console.error('Fallback parser also failed, returning defaults');
        return this.getDefaultResponse(output);
      }
    }
  }

  private fixMalformedJSON(jsonStr: string): string {
    try {
      // First pass: Fix missing commas between array closing and next property
      // Pattern: ]<newline>"propertyName": should be ],<newline>"propertyName":
      jsonStr = jsonStr.replace(/\]\s*\n\s*"/g, '],\n"');
      
      // Also fix: }<newline>"propertyName": should be },<newline>"propertyName":
      jsonStr = jsonStr.replace(/\}\s*\n\s*"/g, '},\n"');

      // Fix missing quotes in array elements
      // Match array elements that start without quotes after [ or ,
      jsonStr = jsonStr.replace(/(\[|\,)\s*\n\s*([A-Z][^"\[\]\{\},]*?)\s*(?=,|\])/g, (match, prefix, content) => {
        // Only fix if it doesn't already start with a quote
        if (!content.startsWith('"')) {
          return `${prefix}\n"${content.trim()}"`;
        }
        return match;
      });

      // Fix lines in arrays that don't start or end with quotes
      // This handles multi-line array elements
      const lines = jsonStr.split('\n');
      const fixed: string[] = [];
      let inArray = false;
      let arrayDepth = 0;

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const trimmed = line.trim();

        // Track array depth
        if (trimmed.includes('[')) {
          arrayDepth += (trimmed.match(/\[/g) || []).length;
          inArray = arrayDepth > 0;
        }
        if (trimmed.includes(']')) {
          arrayDepth -= (trimmed.match(/\]/g) || []).length;
          inArray = arrayDepth > 0;
        }

        // If we're in an array and the line doesn't start with " or end properly
        if (inArray && trimmed.length > 0 && 
            !trimmed.startsWith('"') && 
            !trimmed.startsWith('[') && 
            !trimmed.startsWith(']') &&
            !trimmed.startsWith('{') &&
            !trimmed.startsWith('}') &&
            trimmed !== ',' &&
            !/^\s*"[^"]*"\s*:/.test(trimmed)) { // Not a key-value pair
          
          // Check if line ends with comma or array bracket
          const hasComma = trimmed.endsWith(',');
          const hasClosingBracket = trimmed.endsWith(']');
          
          // Remove trailing comma or bracket temporarily
          let content = trimmed;
          if (hasComma) {
            content = content.slice(0, -1).trim();
          } else if (hasClosingBracket) {
            content = content.slice(0, -1).trim();
          }

          // Add quotes if not present
          if (!content.startsWith('"')) {
            content = '"' + content;
          }
          if (!content.endsWith('"')) {
            content = content + '"';
          }

          // Re-add comma or bracket
          if (hasComma) {
            content += ',';
          } else if (hasClosingBracket) {
            content += ']';
          }

          line = line.replace(trimmed, content);
        }

        fixed.push(line);
      }

      return fixed.join('\n');
    } catch (error) {
      console.error('Error fixing malformed JSON:', error.message);
      return jsonStr; // Return original if fixing fails
    }
  }

  private getDefaultResponse(output: any): any {
    // Extract whatever we can from the output
    console.warn('Using fallback default response due to parsing failure');
    
    return {
      insights: ['Unable to parse full insights from LLM response'],
      trends: ['Data analysis in progress'],
      anomalies: [],
      recommendations: ['Review data quality and retry analysis'],
      summary: 'Analysis could not be completed',
      key_points: ['Parsing error occurred'],
      data_quality: 'unknown',
      record_count: 0,
    };
  }

  // ===== ORCHESTRATOR FUNCTIONALITY =====

  async processRequest(request: string, context?: any): Promise<any> {
    console.log('=== UNI-AGENT: Processing Request ===');
    console.log('Request:', request);
    console.log('Context:', JSON.stringify(context, null, 2));

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
    console.log('=== UNI-AGENT: Executing Workflow ===');
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
    console.log('\n--- Executing Task ---');
    console.log('Original params:', JSON.stringify(task.params, null, 2));
    console.log('Context available:', !!context);
    
    // First resolve task dependencies
    let params = this.enrichParams(task.params, previousResults);
    console.log('After task dependency resolution:', JSON.stringify(params, null, 2));
    
    // Handle export tasks that need to inherit parameters from generate_report tasks
    if (this.isExportTask(task.action) && this.hasUnresolvedParams(params)) {
      params = this.inheritParamsFromGenerateReport(task, previousResults, params);
      console.log('After parameter inheritance:', JSON.stringify(params, null, 2));
    }
    
    // Then inject context values
    if (context) {
      params = this.injectContextIntoParams(params, context);
      console.log('After context injection:', JSON.stringify(params, null, 2));
    }

    switch (task.agent) {
      case 'data':
        return this.executeDataTask(task.action, params);
      
      case 'report':
        return this.executeReportTask(task.action, params);
      
      case 'automation':
        return this.executeAutomationTask(task.action, params);
      
      default:
        throw new Error(`Unknown agent: ${task.agent}`);
    }
  }

  private isExportTask(action: string): boolean {
    return ['export_pdf', 'export_markdown', 'export_json'].includes(action);
  }

  private hasUnresolvedParams(params: any): boolean {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.includes('{task.')) {
        return true;
      }
    }
    return false;
  }

  private inheritParamsFromGenerateReport(task: AgentTask, previousResults: any[], currentParams: any): any {
    console.log('🔧 Attempting parameter inheritance for export task...');
    
    // Find the most recent generate_report task in the dependency chain
    const generateReportResult = this.findGenerateReportResult(task, previousResults);
    
    if (generateReportResult) {
      console.log('✓ Found generate_report result, inheriting parameters...');
      // The generate_report task should have the same parameters we need for export
      // We'll use the same recordId, filename, or data that was used to generate the report
      return {
        ...currentParams,
        // Remove any unresolved task references and use the same parameters as the generate_report task
        recordId: generateReportResult.recordId || currentParams.recordId,
        filename: generateReportResult.filename || currentParams.filename,
        data: generateReportResult.data || currentParams.data,
        reportType: generateReportResult.reportType || currentParams.reportType,
      };
    }
    
    console.warn('⚠️ No generate_report result found for parameter inheritance');
    return currentParams;
  }

  private findGenerateReportResult(task: AgentTask, previousResults: any[]): any {
    // Look for generate_report results in the dependency chain
    const dependencies = (task as any).dependencies || [];
    
    for (const depIdx of dependencies) {
      const depResult = previousResults[depIdx];
      if (depResult && (depResult.metadata || depResult.sections)) {
        // This looks like a report result
        return depResult;
      }
    }
    
    // If no direct dependency, look for any generate_report result
    for (let i = previousResults.length - 1; i >= 0; i--) {
      const result = previousResults[i];
      if (result && (result.metadata || result.sections)) {
        return result;
      }
    }
    
    return null;
  }

  private enrichParams(params: any, previousResults: any[]): any {
    const enriched = { ...params };
    
    for (const [key, value] of Object.entries(enriched)) {
      if (typeof value === 'string') {
        // Match single braces {task.0.field}, double braces {{task.0.field}}, or ${task.0.field}
        const match = value.match(/\{?\{?task\.(\d+)\.(\w+)\}?\}?/);
        if (match && match[0].includes('task.')) {
          const [fullMatch, taskIdx, field] = match;
          const taskResult = previousResults[parseInt(taskIdx)];
          if (taskResult && taskResult[field] !== undefined) {
            console.log(`✓ Replacing ${fullMatch} with result from task ${taskIdx}.${field} = ${taskResult[field]}`);
            enriched[key] = taskResult[field];
          } else {
            console.warn(`✗ Could not resolve ${fullMatch}: task result not found or field missing`);
            console.warn(`  Available fields in task ${taskIdx} result:`, taskResult ? Object.keys(taskResult) : 'no result');
            
            // Special handling for export tasks that might need to inherit parameters from generate_report tasks
            if (field === 'reportId' || field === 'report') {
              console.warn(`  Note: ${field} field does not exist. Export tasks should use the same parameters as the generate_report task.`);
            }
          }
        }
      }
    }
    
    return enriched;
  }

  private injectContextIntoParams(params: any, context: any): any {
    const enriched = { ...params };
    
    console.log('Injecting context into params...');
    console.log('Available context keys:', Object.keys(context));
    
    // Resolve context placeholders in param values
    for (const [key, value] of Object.entries(enriched)) {
      if (typeof value === 'string') {
        // Match both {{context.field}} and ${context.field} patterns
        const match = value.match(/(?:\{\{|\$\{)context\.(\w+)\}\}/);
        if (match) {
          const [fullMatch, field] = match;
          if (context[field] !== undefined) {
            console.log(`✓ Replacing ${fullMatch} with context.${field}`);
            enriched[key] = context[field];
          } else {
            console.warn(`✗ Context field "${field}" not found in context`);
          }
        }
      }
    }
    
    // Auto-inject common context fields if not already present
    if (context.fileData && !enriched.fileData && !enriched.data) {
      console.log('✓ Auto-injecting fileData from context');
      enriched.fileData = context.fileData;
    }
    
    if (context.filename && !enriched.filename) {
      console.log('✓ Auto-injecting filename from context');
      enriched.filename = context.filename;
    }
    
    if (context.recordId && !enriched.recordId) {
      console.log('✓ Auto-injecting recordId from context');
      enriched.recordId = context.recordId;
    }
    
    return enriched;
  }

  private async executeDataTask(action: string, params: any): Promise<any> {
    console.log('Executing DATA task:', action);
    console.log('Final params:', JSON.stringify(params, null, 2));
    
    switch (action) {
      case 'analyze_data':
        return this.analyzeData(params.data);
      
      case 'get_by_id':
        if (!params.id) {
          throw new Error('Missing required parameter: id');
        }
        return this.getRecordById(params.id);
      
      case 'get_by_filename':
        if (!params.filename) {
          throw new Error('Missing required parameter: filename');
        }
        return this.findRecordByFilename(params.filename);
      
      case 'process_data':
      case 'upload_and_process':
        const data = params.fileData || params.data;
        const filename = params.filename || 'uploaded_file.csv';
        const tags = params.tags;
        
        if (!data) {
          throw new Error('No data provided for processing. Ensure fileData or data is in params.');
        }
        
        console.log('Processing data:');
        console.log('  - filename:', filename);
        console.log('  - data length:', data.length);
        console.log('  - tags:', tags);
        
        return this.analyzeAndProcess(data, filename, tags);
      
      default:
        throw new Error(`Unknown data task: ${action}`);
    }
  }

  private async executeReportTask(action: string, params: any): Promise<any> {
    console.log('Executing REPORT task:', action);
    console.log('Final params:', JSON.stringify(params, null, 2));
    
    switch (action) {
      case 'generate_report':
        if (!params.recordId && !params.filename && !params.data) {
          throw new Error('Missing required parameter: recordId, filename, or data');
        }
        return this.generateReport({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
          reportType: params.reportType || 'standard',
        });
      
      case 'create_summary':
        if (!params.recordId && !params.filename && !params.data) {
          throw new Error('Missing required parameter: recordId, filename, or data');
        }
        return this.createSummary({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
        });
      
      case 'export_pdf':
        const pdfReport = await this.generateReport({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
          reportType: params.reportType,
        });
        return this.exportPdf(pdfReport);
      
      case 'export_markdown':
        const mdReport = await this.generateReport({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
          reportType: params.reportType,
        });
        return this.formatReportAsMarkdown(mdReport);
      
      case 'export_json':
        const jsonReport = await this.generateReport({
          recordId: params.recordId,
          filename: params.filename,
          data: params.data,
          reportType: params.reportType,
        });
        return this.formatReportAsJson(jsonReport);
      
      case 'get_statistics':
        if (!params.data) {
          throw new Error('Missing required parameter: data');
        }
        return this.getDataStatistics(params.data);
      
      default:
        throw new Error(`Unknown report task: ${action}`);
    }
  }

  private async executeAutomationTask(action: string, params: any): Promise<any> {
    console.log('Executing AUTOMATION task:', action, params);
    
    // Placeholder - implement when AutomationAgentService is ready
    return {
      message: `Automation task '${action}' executed (placeholder)`,
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

  async processFileUpload(file: Express.Multer.File, request: string, userContext?: any): Promise<any> {
    console.log('=== UNI-AGENT: Processing File Upload ===');
    console.log('Filename:', file.originalname);
    console.log('File size:', file.size);
    console.log('Request:', request);
    if (userContext) {
      console.log('User Context:', JSON.stringify(userContext, null, 2));
    }

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

    console.log('Extracted text length:', text.length);
    console.log('First 100 chars:', text.substring(0, 100));

    const context = {
      filename: file.originalname,
      fileSize: file.size,
      fileType: ext,
      fileData: text,
    };

    const enhancedRequest = `
      A file named "${file.originalname}" has been uploaded and extracted.
      Task: ${request}
      
      The file data is available in the context and ready to be processed and saved to the database.
    `;

    return this.processRequest(enhancedRequest, context);
  }

  // ===== DATA AGENT FUNCTIONALITY =====

  async findRecordByFilename(filename: string) {
    filename = filename.replace(/\.[^/.]+$/, ""); // Remove extension if present
    const record = await this.knowledgeBaseRepository.findOne({
      where: { title: filename },
    });

    if (!record) {
      throw new NotFoundException(`Record with filename "${filename}" not found`);
    }

    return record;
  }

  async getRecordById(id: string) {
    const record = await this.knowledgeBaseRepository.findOne({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException(`Record with id ${id} not found`);
    }

    return record;
  }

  async analyzeData(data: string) {
    try {
      const result = await this.dataAnalysisChain.invoke({ data });
      console.log('Analysis result:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error('Analysis error:', error);
      return { error: "Failed to parse model output", details: error.message };
    }
  }

  async executeActions(data: string, analysis: any) {
    console.log('Executing actions with analysis:', analysis);
    let result = data;
    
    // Execute in proper order: clean → transform → validate
    if (analysis.needs_cleaning) {
      console.log('Running clean tool...');
      result = this.tools.find((t) => t.name === "clean")!.call(result);
      console.log('After cleaning:', result.substring(0, 200));
    }
    
    if (analysis.needs_transformation) {
      console.log('Running transform tool...');
      result = this.tools.find((t) => t.name === "transform")!.call(result);
      console.log('After transformation:', result.substring(0, 200));
    }
    
    if (analysis.needs_validation) {
      console.log('Running validate tool...');
      result = this.tools.find((t) => t.name === "validate")!.call(result);
      console.log('After validation:', result.substring(0, 200));
    }
    
    return result;
  }

  async analyzeAndProcess(
    data: string,
    fileName: string,
    tags?: string
  ) {
    console.log('Starting analyzeAndProcess with data length:', data.length);
    console.log('First 200 chars:', data.substring(0, 200));
    
    const analysis = await this.analyzeData(data);
    const processedData = await this.executeActions(data, analysis);

    const saved = await this.saveProcessedFile({
      title: fileName,
      content: processedData,
      tags,
    });

    return {
      analysis,
      processedData,
      recordId: saved.id,
    };
  }

  async saveProcessedFile(params: {
    title: string;
    content: string;
    tags?: string;
  }) {
    const parts = params.title.split('.');
    const extension = parts.length > 1 ? parts.pop()?.toLowerCase() : 'unknown';
    const titleWithoutExt = parts.join('.');

    const entity = this.knowledgeBaseRepository.create({
      title: titleWithoutExt,
      content: params.content,
      raw_content: params.content,
      analysis_summary: 'No summary yet',
      filename: params.title,
      file_type: extension,
      tags: params.tags,
    });

    const saved = await this.knowledgeBaseRepository.save(entity);
    return saved;
  }

  // ===== REPORT AGENT FUNCTIONALITY =====

  async generateReport(params: {
    recordId?: string;
    filename?: string;
    data?: string;
    reportType?: string;
  }): Promise<GeneratedReport> {
    console.log('=== UNI-AGENT: Generating Report ===');
    console.log('Params:', params);

    // Get data from various sources
    let data: string;
    let sourceInfo: string;
    let recordCount = 0;

    if (params.data) {
      data = params.data;
      sourceInfo = 'Direct data input';
    } else if (params.recordId) {
      const record = await this.knowledgeBaseRepository.findOne({
        where: { id: params.recordId },
      });
      if (!record) {
        throw new NotFoundException(`Record with ID ${params.recordId} not found`);
      }
      data = record.content;
      sourceInfo = record.filename || record.title;
    } else if (params.filename) {
      const record = await this.knowledgeBaseRepository.findOne({
        where: { title: params.filename },
      });
      if (!record) {
        throw new NotFoundException(`Record with filename ${params.filename} not found`);
      }
      data = record.content;
      sourceInfo = record.filename || record.title;
    } else {
      throw new Error('Must provide either recordId, filename, or data');
    }

    // Count records (assume CSV format)
    const lines = data.split('\n').filter(line => line.trim().length > 0);
    recordCount = Math.max(0, lines.length - 1); // Subtract header

    // Truncate data if too large for LLM context
    const maxDataLength = 8000;
    let truncatedData = data;
    let wasTruncated = false;
    
    if (data.length > maxDataLength) {
      console.warn(`Data too large (${data.length} chars), truncating to ${maxDataLength} chars`);
      truncatedData = data.substring(0, maxDataLength) + '\n...[data truncated]...';
      wasTruncated = true;
    }

    try {
      // Generate summary
      console.log('Generating summary...');
      const summaryResult = await this.summaryChain.invoke({ data: truncatedData });
      console.log('Summary generated:', JSON.stringify(summaryResult, null, 2));

      // Generate insights
      console.log('Generating insights...');
      const insightsResult = await this.insightsChain.invoke({
        data: truncatedData,
        summary: summaryResult.summary || '',
      });
      console.log('Insights generated:', JSON.stringify(insightsResult, null, 2));

      // Build report sections with defensive checks
      const sections: ReportSection[] = [
        {
          title: 'Executive Summary',
          content: summaryResult.summary || 'Summary not available',
          insights: Array.isArray(summaryResult.key_points) ? summaryResult.key_points : [],
        },
        {
          title: 'Data Quality Assessment',
          content: summaryResult.data_quality || 'Data quality assessment not available',
        },
        {
          title: 'Key Insights',
          content: 'Analysis of the dataset reveals the following insights:',
          insights: Array.isArray(insightsResult.insights) ? insightsResult.insights : [],
        },
      ];

      if (Array.isArray(insightsResult.trends) && insightsResult.trends.length > 0) {
        sections.push({
          title: 'Trends and Patterns',
          content: 'The following trends were identified in the data:',
          insights: insightsResult.trends,
        });
      }

      if (Array.isArray(insightsResult.anomalies) && insightsResult.anomalies.length > 0) {
        sections.push({
          title: 'Anomalies and Outliers',
          content: 'The following anomalies were detected:',
          insights: insightsResult.anomalies,
        });
      }

      if (wasTruncated) {
        sections.push({
          title: 'Note',
          content: 'This analysis was performed on a sample of the data due to size constraints. For complete analysis, consider processing smaller data segments.',
        });
      }

      // Build metadata
      const metadata: ReportMetadata = {
        title: `Data Analysis Report - ${sourceInfo}`,
        generatedAt: new Date(),
        dataSource: sourceInfo,
        recordCount,
        reportType: params.reportType || 'standard',
      };

      const report: GeneratedReport = {
        metadata,
        sections,
        summary: summaryResult.summary || 'Summary not available',
        recommendations: Array.isArray(insightsResult.recommendations) ? insightsResult.recommendations : [],
      };

      console.log('Report generated successfully');
      return report;
    } catch (error) {
      console.error('Error generating report:', error);
      console.error('Error stack:', error.stack);
      
      // Return a basic report with error information
      return this.generateFallbackReport(sourceInfo, recordCount, error.message);
    }
  }

  private generateFallbackReport(
    sourceInfo: string,
    recordCount: number,
    errorMessage: string
  ): GeneratedReport {
    console.warn('Generating fallback report due to error');
    
    return {
      metadata: {
        title: `Data Analysis Report - ${sourceInfo}`,
        generatedAt: new Date(),
        dataSource: sourceInfo,
        recordCount,
        reportType: 'fallback',
      },
      sections: [
        {
          title: 'Report Generation Error',
          content: 'An error occurred while generating the detailed analysis. Please review the data and try again.',
        },
        {
          title: 'Basic Information',
          content: `The dataset contains ${recordCount} records from ${sourceInfo}.`,
        },
      ],
      summary: `Basic report for ${sourceInfo} with ${recordCount} records. Detailed analysis could not be completed.`,
      recommendations: [
        'Check data format and quality',
        'Ensure Google Gemini API key is configured',
        'Try with a smaller dataset',
        'Review error logs for details',
      ],
    };
  }

  async createSummary(params: {
    recordId?: string;
    filename?: string;
    data?: string;
  }): Promise<any> {
    console.log('=== UNI-AGENT: Creating Summary ===');

    // Get data
    let data: string;

    if (params.data) {
      data = params.data;
    } else if (params.recordId) {
      const record = await this.knowledgeBaseRepository.findOne({
        where: { id: params.recordId },
      });
      if (!record) {
        throw new NotFoundException(`Record with ID ${params.recordId} not found`);
      }
      data = record.content;
    } else if (params.filename) {
      const record = await this.knowledgeBaseRepository.findOne({
        where: { title: params.filename },
      });
      if (!record) {
        throw new NotFoundException(`Record with filename ${params.filename} not found`);
      }
      data = record.content;
    } else {
      throw new Error('Must provide either recordId, filename, or data');
    }

    // Generate summary
    const summaryResult = await this.summaryChain.invoke({ data });
    return summaryResult;
  }

  async exportPdf(report: GeneratedReport): Promise<string> {
    console.log('=== UNI-AGENT: Exporting PDF ===');

    // Generate HTML content for PDF
    const html = this.generateReportHtml(report);

    // In a real implementation, you would use a library like puppeteer or pdfkit
    // For now, we'll return the HTML as a placeholder
    console.log('PDF export would be generated here');
    console.log('Report title:', report.metadata.title);

    return html;
  }

  private generateReportHtml(report: GeneratedReport): string {
    const sectionsHtml = report.sections
      .map(section => {
        const insightsHtml = section.insights
          ? `<ul>${section.insights.map(insight => `<li>${insight}</li>`).join('')}</ul>`
          : '';

        return `
        <div class="section">
          <h2>${section.title}</h2>
          <p>${section.content}</p>
          ${insightsHtml}
        </div>
      `;
      })
      .join('');

    const recommendationsHtml = report.recommendations
      ? `
      <div class="section">
        <h2>Recommendations</h2>
        <ul>${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}</ul>
      </div>
    `
      : '';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${report.metadata.title}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    h2 {
      color: #34495e;
      margin-top: 30px;
      border-bottom: 1px solid #ecf0f1;
      padding-bottom: 5px;
    }
    .metadata {
      background: #ecf0f1;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .metadata p {
      margin: 5px 0;
    }
    .section {
      margin-bottom: 30px;
    }
    ul {
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <h1>${report.metadata.title}</h1>
  
  <div class="metadata">
    <p><strong>Generated:</strong> ${report.metadata.generatedAt.toLocaleString()}</p>
    <p><strong>Data Source:</strong> ${report.metadata.dataSource}</p>
    <p><strong>Record Count:</strong> ${report.metadata.recordCount}</p>
    <p><strong>Report Type:</strong> ${report.metadata.reportType}</p>
  </div>

  ${sectionsHtml}
  ${recommendationsHtml}
</body>
</html>
    `;
  }

  async formatReportAsMarkdown(report: GeneratedReport): Promise<string> {
    let markdown = `# ${report.metadata.title}\n\n`;
    markdown += `**Generated:** ${report.metadata.generatedAt.toLocaleString()}\n`;
    markdown += `**Data Source:** ${report.metadata.dataSource}\n`;
    markdown += `**Record Count:** ${report.metadata.recordCount}\n`;
    markdown += `**Report Type:** ${report.metadata.reportType}\n\n`;
    markdown += `---\n\n`;

    for (const section of report.sections) {
      markdown += `## ${section.title}\n\n`;
      markdown += `${section.content}\n\n`;

      if (section.insights && section.insights.length > 0) {
        section.insights.forEach(insight => {
          markdown += `- ${insight}\n`;
        });
        markdown += '\n';
      }
    }

    if (report.recommendations && report.recommendations.length > 0) {
      markdown += `## Recommendations\n\n`;
      report.recommendations.forEach(rec => {
        markdown += `- ${rec}\n`;
      });
      markdown += '\n';
    }

    return markdown;
  }

  async formatReportAsJson(report: GeneratedReport): Promise<any> {
    return {
      metadata: report.metadata,
      sections: report.sections,
      summary: report.summary,
      recommendations: report.recommendations,
    };
  }

  // Convenience method for quick statistics
  async getDataStatistics(data: string): Promise<any> {
    const lines = data.split('\n').filter(line => line.trim().length > 0);
    const headers = lines[0]?.split(',') || [];
    const recordCount = lines.length - 1;

    // Count invalid entries
    const invalidCounts = {
      emails: 0,
      dates: 0,
      ages: 0,
      phones: 0,
      amounts: 0,
    };

    lines.slice(1).forEach(line => {
      if (line.includes('[INVALID_EMAIL]')) invalidCounts.emails++;
      if (line.includes('[INVALID_DATE]')) invalidCounts.dates++;
      if (line.includes('[INVALID_AGE]')) invalidCounts.ages++;
      if (line.includes('[INVALID_PHONE]')) invalidCounts.phones++;
      if (line.includes('[INVALID_AMOUNT]')) invalidCounts.amounts++;
    });

    return {
      totalRecords: recordCount,
      columns: headers,
      columnCount: headers.length,
      invalidCounts,
      hasInvalidData: Object.values(invalidCounts).some(count => count > 0),
    };
  }
}

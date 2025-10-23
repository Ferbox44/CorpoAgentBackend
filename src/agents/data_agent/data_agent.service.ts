// import { Injectable, NotFoundException } from "@nestjs/common";
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { ChatOllama } from "@langchain/ollama";
// import { ChatPromptTemplate } from "@langchain/core/prompts";
// import { z } from "zod";
// import { StructuredOutputParser } from "langchain/output_parsers";
// import { RunnableSequence } from "@langchain/core/runnables";
// import { KnowledgeBase } from '../../entities/knowledge_base.entity';

// interface Tool {
//   name: string;
//   description: string;
//   call: (data: string) => string;
// }

// function parseCSV(data: string): { headers: string[], rows: string[][] } {
//   // Handle both actual newlines and literal \n strings
//   const normalizedData = data.replace(/\\n/g, '\n');
//   const lines = normalizedData.trim().split('\n').filter(line => line.trim().length > 0);
  
//   if (lines.length < 2) {
//     throw new Error('Invalid CSV: needs at least header and one row');
//   }
  
//   // Parse a single CSV line handling quotes
//   function parseCSVLine(line: string): string[] {
//     const result: string[] = [];
//     let current = '';
//     let inQuotes = false;
    
//     for (let i = 0; i < line.length; i++) {
//       const char = line[i];
//       const nextChar = line[i + 1];
      
//       if (char === '"') {
//         if (inQuotes && nextChar === '"') {
//           // Escaped quote
//           current += '"';
//           i++; // Skip next quote
//         } else {
//           // Toggle quote mode
//           inQuotes = !inQuotes;
//         }
//       } else if (char === ',' && !inQuotes) {
//         // End of field
//         result.push(current.trim());
//         current = '';
//       } else {
//         current += char;
//       }
//     }
    
//     // Add last field
//     result.push(current.trim());
//     return result;
//   }
  
//   const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
//   const headerCount = headers.length;
  
//   const rows = lines.slice(1).map((line, idx) => {
//     const cells = parseCSVLine(line);
    
//     // Pad row if it has fewer cells than headers
//     while (cells.length < headerCount) {
//       console.warn(`Row ${idx + 2} has ${cells.length} cells but expected ${headerCount}. Padding with empty string.`);
//       cells.push('');
//     }
    
//     // Truncate row if it has more cells than headers
//     if (cells.length > headerCount) {
//       console.warn(`Row ${idx + 2} has ${cells.length} cells but expected ${headerCount}. Truncating from ${cells.length} to ${headerCount}.`);
//       console.warn(`Extra values: ${cells.slice(headerCount).join(', ')}`);
//       return cells.slice(0, headerCount);
//     }
    
//     return cells;
//   });
  
//   return { headers, rows };
// }

// function reconstructCSV(headers: string[], rows: string[][]): string {
//   return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
// }

// @Injectable()
// export class DataAgentService {
//   private readonly model: ChatOllama;
//   private readonly chain: RunnableSequence;
//   private readonly tools: Tool[];

//   constructor(
//     @InjectRepository(KnowledgeBase)
//     private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
//   ) {

//     this.model = new ChatOllama({
//       model: "llama3",
//       baseUrl: "http://localhost:11434",
//       temperature: 0,
//     });

//     const outputSchema = z.object({
//       needs_cleaning: z.boolean(),
//       needs_transformation: z.boolean(),
//       needs_validation: z.boolean(),
//       raw_text_allowed: z.boolean().optional(),
//       explanation: z.string(),
//     });

//     const parser = StructuredOutputParser.fromZodSchema(outputSchema);
//     const formatInstructions = parser.getFormatInstructions().replace(/{/g, "{{").replace(/}/g, "}}");

//     const promptTemplate = `
// You are a data quality analyst. Analyze the provided data and determine what processing is needed.

// DEFINITIONS:
// - needs_cleaning: true if data contains NULL, N/A, empty values, or needs whitespace normalization
// - needs_transformation: true if dates need standardization (to YYYY-MM-DD), emails need lowercase, phone numbers need formatting, or currency has commas
// - needs_validation: true if you need to check for invalid emails (missing @), ages outside 0-120, invalid dates, or amounts outside reasonable ranges

// RULES:
// - If the data is NOT tabular/CSV format, set raw_text_allowed=true and all other flags to false
// - If the data IS tabular (has rows and columns), analyze what processing it needs
// - Look for patterns like: NULL values, inconsistent date formats (MM/DD/YYYY vs YYYY-MM-DD), mixed case emails, unformatted phone numbers
// - Check if ages contain text instead of numbers, if emails are missing @, if dates are malformed

// Use this exact JSON format:
// ${formatInstructions}

// Data to analyze:
// {data}

// Provide your analysis:`;

//     const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
//     this.chain = RunnableSequence.from([prompt, this.model, parser]);
    
//     this.tools = [
//       {
//         name: "clean",
//         description: "Removes null values, duplicates, and corrects formatting errors. Handles multiple data separators and replaces empty fields with 'Unknown'.",
//         call: (data: string): string => {
//           if (!data || typeof data !== 'string') return '';
          
//           try {
//             const { headers, rows } = parseCSV(data);
            
//             const cleanedRows = rows.map(row => {
//               return row.map(cell => {
//                 // Replace null/empty patterns
//                 const nullPatterns = /^(NULL|N\/A|null|na|n\/a|PENDING|TBD|undefined|nil|none|--|)$/gi;
//                 if (nullPatterns.test(cell)) {
//                   return 'Unknown';
//                 }
//                 // Normalize whitespace
//                 return cell.replace(/\s+/g, ' ').trim();
//               });
//             });
            
//             return reconstructCSV(headers, cleanedRows);
//           } catch (e) {
//             console.error('Clean tool CSV parsing failed:', e.message);
//             // Fallback to simple cleaning if CSV parsing fails
//             let cleaned = data;
//             cleaned = cleaned.replace(/\b(NULL|N\/A|null|na|n\/a|PENDING|TBD|undefined|nil|none|--)\b/gi, 'Unknown');
//             cleaned = cleaned.replace(/\s+/g, ' ').trim();
//             return cleaned;
//           }
//         },
//       },
//       {
//         name: "transform",
//         description: "Standardizes date formats (to ISO 8601), phone numbers, emails, currency values, and common data types.",
//         call: (data: string): string => {
//           if (!data || typeof data !== 'string') return '';
          
//           try {
//             const { headers, rows } = parseCSV(data);
            
//             const transformedRows = rows.map(row => {
//               return row.map((cell, idx) => {
//                 // Safety check: ensure header exists for this index
//                 if (idx >= headers.length) {
//                   console.warn(`Column index ${idx} exceeds header count ${headers.length}`);
//                   return cell;
//                 }
                
//                 const header = headers[idx] || '';
                
//                 // Transform dates
//                 if (header.includes('date') || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cell)) {
//                   // MM/DD/YYYY to YYYY-MM-DD
//                   cell = cell.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (match, m, d, y) => {
//                     const month = m.padStart(2, '0');
//                     const day = d.padStart(2, '0');
//                     if (parseInt(month) > 12 || parseInt(day) > 31) return match;
//                     return `${y}-${month}-${day}`;
//                   });
                  
//                   // DD-MM-YYYY to YYYY-MM-DD
//                   cell = cell.replace(/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (match, d, m, y) => {
//                     const month = m.padStart(2, '0');
//                     const day = d.padStart(2, '0');
//                     if (parseInt(month) > 12 || parseInt(day) > 31) return match;
//                     return `${y}-${month}-${day}`;
//                   });
                  
//                   // YYYY/MM/DD to YYYY-MM-DD
//                   cell = cell.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (match, y, m, d) => {
//                     const month = m.padStart(2, '0');
//                     const day = d.padStart(2, '0');
//                     if (parseInt(month) > 12 || parseInt(day) > 31) return match;
//                     return `${y}-${month}-${day}`;
//                   });
//                 }
                
//                 // Transform emails to lowercase
//                 if (header.includes('email') || cell.includes('@')) {
//                   const validEmailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
//                   if (validEmailPattern.test(cell)) {
//                     cell = cell.toLowerCase();
//                   }
//                 }
                
//                 // Transform phone numbers
//                 if (header.includes('phone') || /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(cell)) {
//                   cell = cell.replace(/\+?1?[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/, '$1-$2-$3');
//                 }
                
//                 // Transform currency - be more specific to avoid breaking CSV structure
//                 if (header.includes('salary') || header.includes('price') || header.includes('amount')) {
//                   // Remove commas from currency values (e.g., 75,000 → 75000)
//                   cell = cell.replace(/^(\d{1,3}(?:,\d{3})+)$/, (match) => {
//                     return match.replace(/,/g, '');
//                   });
//                   // Also handle with dollar sign: $75,000 → 75000
//                   cell = cell.replace(/^\$(\d{1,3}(?:,\d{3})+(?:\.\d{2})?)$/, (match, num) => {
//                     return num.replace(/,/g, '');
//                   });
//                 }
                
//                 return cell;
//               });
//             });
            
//             return reconstructCSV(headers, transformedRows);
//           } catch (e) {
//             console.error('Transform tool CSV parsing failed:', e.message);
//             // Fallback to regex-based transformation
//             let transformed = data;
//             transformed = transformed.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (match, m, d, y) => {
//               return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
//             });
//             transformed = transformed.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, (m) => m.toLowerCase());
//             return transformed;
//           }
//         },
//       },
//       {
//         name: "validate",
//         description: "Validates emails, dates, ages, and numeric ranges based on column context. Marks invalid entries with [INVALID_*] tags.",
//         call: (data: string): string => {
//           if (!data || typeof data !== 'string') return '';
          
//           try {
//             const { headers, rows } = parseCSV(data);
            
//             const validatedRows = rows.map(row => {
//               return row.map((cell, idx) => {
//                 // Safety check: ensure header exists for this index
//                 if (idx >= headers.length) {
//                   console.warn(`Column index ${idx} exceeds header count ${headers.length}`);
//                   return cell;
//                 }
                
//                 const header = headers[idx] || '';
                
//                 // Validate email columns - ONLY in email columns
//                 if (header === 'email' || header.includes('email')) {
//                   const validEmailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
//                   if (!validEmailPattern.test(cell) && cell.toLowerCase() !== 'unknown') {
//                     return '[INVALID_EMAIL]';
//                   }
//                 }
                
//                 // Validate age columns - ONLY in age columns
//                 if (header === 'age' || header.includes('age')) {
//                   // Check if it's not a valid number and not 'Unknown'
//                   if (!/^\d+$/.test(cell) && cell.toLowerCase() !== 'unknown') {
//                     return '[INVALID_AGE]';
//                   }
//                   // Check if numeric age is out of range
//                   if (/^\d+$/.test(cell)) {
//                     const age = parseInt(cell);
//                     if (age < 0 || age > 120) {
//                       return '[INVALID_AGE]';
//                     }
//                   }
//                 }
                
//                 // Validate date columns - ONLY in date columns
//                 if (header === 'date' || header.includes('date')) {
//                   const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
//                   const match = cell.match(datePattern);
//                   if (match && cell.toLowerCase() !== 'unknown') {
//                     const [, y, m, d] = match;
//                     const year = parseInt(y);
//                     const month = parseInt(m);
//                     const day = parseInt(d);
                    
//                     if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) {
//                       return '[INVALID_DATE]';
//                     }
//                     if (month === 2 && day > 29) return '[INVALID_DATE]';
//                     if ([4, 6, 9, 11].includes(month) && day > 30) return '[INVALID_DATE]';
//                   } else if (!match && cell.toLowerCase() !== 'unknown' && /\d/.test(cell)) {
//                     // Date column has data but not in correct format
//                     return '[INVALID_DATE]';
//                   }
//                 }
                
//                 // Validate phone columns - ONLY in phone columns
//                 if (header === 'phone' || header.includes('phone')) {
//                   const phonePattern = /^(\d{3})-(\d{3})-(\d{4})$/;
//                   const match = cell.match(phonePattern);
//                   if (match) {
//                     const [, area] = match;
//                     if (area[0] === '0' || area[0] === '1') {
//                       return '[INVALID_PHONE]';
//                     }
//                   } else if (cell.toLowerCase() !== 'unknown' && /\d/.test(cell)) {
//                     return '[INVALID_PHONE]';
//                   }
//                 }
                
//                 // Validate salary/amount columns - ONLY in these columns
//                 if (header === 'salary' || header === 'amount' || header === 'price' || 
//                     header.includes('salary') || header.includes('amount') || header.includes('price')) {
//                   if (/^-?\d+$/.test(cell)) {
//                     const amount = parseInt(cell);
//                     if (amount < 0 || amount > 10000000) {
//                       return '[INVALID_AMOUNT]';
//                     }
//                   }
//                 }
                
//                 return cell;
//               });
//             });
            
//             return reconstructCSV(headers, validatedRows);
//           } catch (e) {
//             console.error('Validate tool CSV parsing failed:', e.message);
//             // If CSV parsing fails, return original data
//             return data;
//           }
//         },
//       },
//       {
//         name: "deduplicate",
//         description: "Removes duplicate rows from the dataset while preserving the header.",
//         call: (data: string): string => {
//           if (!data || typeof data !== 'string') return '';
          
//           try {
//             const { headers, rows } = parseCSV(data);
            
//             const uniqueRows: string[][] = [];
//             const seen = new Set<string>();
            
//             for (const row of rows) {
//               const rowKey = row.join('|');
//               if (!seen.has(rowKey)) {
//                 seen.add(rowKey);
//                 uniqueRows.push(row);
//               }
//             }
            
//             return reconstructCSV(headers, uniqueRows);
//           } catch (e) {
//             console.error('Deduplicate tool CSV parsing failed:', e.message);
//             const lines = data.split('\n');
//             const uniqueLines = [...new Set(lines.map(line => line.trim()))].filter(line => line.length > 0);
//             return uniqueLines.join('\n');
//           }
//         },
//       },
//       {
//         name: "normalize",
//         description: "Normalizes text casing, state codes, and whitespace consistently across all fields.",
//         call: (data: string): string => {
//           if (!data || typeof data !== 'string') return '';
          
//           try {
//             const { headers, rows } = parseCSV(data);
            
//             const normalizedRows = rows.map(row => {
//               return row.map((cell, idx) => {
//                 // Safety check: ensure header exists for this index
//                 if (idx >= headers.length) {
//                   console.warn(`Column index ${idx} exceeds header count ${headers.length}`);
//                   return cell;
//                 }
                
//                 const header = headers[idx] || '';
                
//                 // Normalize name fields to Title Case
//                 if (header.includes('name')) {
//                   cell = cell.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
//                 }
                
//                 // Normalize state codes
//                 if (header.includes('state')) {
//                   const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
//                   if (states.includes(cell.toUpperCase())) {
//                     cell = cell.toUpperCase();
//                   }
//                 }
                
//                 return cell.trim();
//               });
//             });
            
//             return reconstructCSV(headers, normalizedRows);
//           } catch (e) {
//             console.error('Normalize tool CSV parsing failed:', e.message);
//             return data.trim();
//           }
//         },
//       }
//     ];
//   }

//   async findRecordByFilename(filename: string) {
//     filename = filename.replace(/\.[^/.]+$/, ""); // Remove extension if present
//     const record = await this.knowledgeBaseRepository.findOne({
//       where: { title: filename },
//     });

//     if (!record) {
//       throw new NotFoundException(`Record with filename "${filename}" not found`);
//     }

//     return record;
//   }

//   async getRecordById(id: string) {
//     const record = await this.knowledgeBaseRepository.findOne({
//       where: { id },
//     });

//     if (!record) {
//       throw new NotFoundException(`Record with id ${id} not found`);
//     }

//     return record;
//   }

//   async analyzeData(data: string) {
//     try {
//       const result = await this.chain.invoke({ data });
//       console.log('Analysis result:', JSON.stringify(result, null, 2));
//       return result;
//     } catch (error) {
//       console.error('Analysis error:', error);
//       return { error: "Failed to parse model output", details: error.message };
//     }
//   }

//   async executeActions(data: string, analysis: any) {
//     console.log('Executing actions with analysis:', analysis);
//     let result = data;
    
//     // Execute in proper order: clean → transform → validate
//     if (analysis.needs_cleaning) {
//       console.log('Running clean tool...');
//       result = this.tools.find((t) => t.name === "clean")!.call(result);
//       console.log('After cleaning:', result.substring(0, 200));
//     }
    
//     if (analysis.needs_transformation) {
//       console.log('Running transform tool...');
//       result = this.tools.find((t) => t.name === "transform")!.call(result);
//       console.log('After transformation:', result.substring(0, 200));
//     }
    
//     if (analysis.needs_validation) {
//       console.log('Running validate tool...');
//       result = this.tools.find((t) => t.name === "validate")!.call(result);
//       console.log('After validation:', result.substring(0, 200));
//     }
    
//     return result;
//   }

//   async analyzeAndProcess(
//     data: string,
//     fileName: string,
//     tags?: string
//   ) {
//     console.log('Starting analyzeAndProcess with data length:', data.length);
//     console.log('First 200 chars:', data.substring(0, 200));
    
//     const analysis = await this.analyzeData(data);
//     const processedData = await this.executeActions(data, analysis);

//     const saved = await this.saveProcessedFile({
//       title: fileName,
//       content: processedData,
//       tags,
//     });

//     return {
//       analysis,
//       processedData,
//       recordId: saved.id,
//     };
//   }

//   async saveProcessedFile(params: {
//     title: string;
//     content: string;
//     tags?: string;
//   }) {
//     const parts = params.title.split('.');
//     const extension = parts.length > 1 ? parts.pop()?.toLowerCase() : 'unknown';
//     const titleWithoutExt = parts.join('.');

//     const entity = this.knowledgeBaseRepository.create({
//       title: titleWithoutExt,
//       content: params.content,
//       raw_content: params.content,
//       analysis_summary: 'No summary yet',
//       filename: params.title,
//       file_type: extension,
//       tags: params.tags,
//     });

//     const saved = await this.knowledgeBaseRepository.save(entity);
//     return saved;
//   }
// }
import { Injectable } from "@nestjs/common";
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatOllama } from "@langchain/ollama";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { StructuredOutputParser } from "langchain/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { KnowledgeBase } from '../../entities/knowledge_base.entity';

interface Tool {
  name: string;
  description: string;
  call: (data: string) => string;
}

@Injectable()
export class DataAgentService {
  private readonly model: ChatOllama;
  private readonly chain: RunnableSequence;
  private readonly tools: Tool[];
  
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
  ) {
    
    this.model = new ChatOllama({
      model: "llama3",
      baseUrl: "http://localhost:11434",
      temperature: 0,
    });

    const outputSchema = z.object({
      needs_cleaning: z.boolean(),
      needs_transformation: z.boolean(),
      needs_validation: z.boolean(),
      raw_text_allowed: z.boolean().optional(),
      explanation: z.string(),
    });

    const parser = StructuredOutputParser.fromZodSchema(outputSchema);
    const formatInstructions = parser.getFormatInstructions().replace(/{/g, "{{").replace(/}/g, "}}");

    const promptTemplate = `
    You are a specialized assistant in corporate data analysis.
    Analyze the provided data and determine if it requires cleaning, transformation, or validation.
    Use the following format:
    ${formatInstructions}

    If the text is not a dataset, return raw_text_allowed: true and mark the the other boolean fields as false.
    If the text does not contains tabular data, do not perform any action. 

    Data:
    {data}

    `;

    const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);
    this.chain = RunnableSequence.from([prompt, this.model, parser]);
    this.tools = [
      {
        name: "clean",
        description: "Eliminates null values and corrects simple errors",
        call: (data) => {
          let cleaned = data;
          cleaned = cleaned.replace(/\|{2,}/g, '|');
          cleaned = cleaned.replace(/\b(NULL|N\/A|null|na|n\/a|PENDING|TBD)\b/gi, '');
          cleaned = cleaned.replace(/,,+/g, ',Unknown,');
          cleaned = cleaned.replace(/,\s*\|/g, ',Unknown|');
          cleaned = cleaned.replace(/\|\s*,/g, '|Unknown,');
          cleaned = cleaned.replace(/\s+/g, ' ').trim();
          return cleaned;
        },
      },
      {
        name: "transform",
        description: "Unifies date formats and data types",
        call: (data) => {
          let transformed = data;
          // Transform MM/DD/YYYY to YYYY-MM-DD
          transformed = transformed.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (match, m, d, y) => {
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          });
          // Transform DD-MM-YYYY to YYYY-MM-DD
          transformed = transformed.replace(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/g, (match, d, m, y) => {
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          });
          // Standardize phone numbers
          transformed = transformed.replace(/\+?1?[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g, '$1-$2-$3');
          // Normalize emails to lowercase
          transformed = transformed.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, 
            (match) => match.toLowerCase()
          );
          // Remove commas from salary numbers
          transformed = transformed.replace(/\$(\d+),(\d+)/g, '$$$1$2');
          return transformed;
        },
      },
      {
        name: "validate",
        description: "Validates emails and age ranges",
        call: (data) => {
          let validated = data;
          // Mark invalid emails
          validated = validated.replace(/([a-zA-Z0-9._-]+)@\.([a-zA-Z0-9.-]*)/g, '[INVALID_EMAIL]');
          validated = validated.replace(/([a-zA-Z0-9._-]*)@@([a-zA-Z0-9._-]*)/g, '[INVALID_EMAIL]');
          // Mark invalid ages
          validated = validated.replace(/,\s*(-?\d+)\s*,/g, (match, age) => {
            const ageNum = parseInt(age);
            if (ageNum < 0 || ageNum > 120) {
              return ',[INVALID_AGE],';
            }
            return match;
          });
          // Mark unrealistic numbers
          validated = validated.replace(/,(200|300|400),/g, ',[INVALID_VALUE],');
          return validated;
        },
      },
    ];
  }

  async analyzeData(data: string) {
    try {
      const result = await this.chain.invoke({ data });
      return result;
    } catch (error) {
      return { error: "Failed to parse model output", details: error.message };
    }
  }

  async executeActions(data: string, analysis: any) {
    let result = data;
    if (analysis.needs_cleaning) {
      result = this.tools.find((t) => t.name === "clean")!.call(result);
    }
    if (analysis.needs_transformation) {
      result = this.tools.find((t) => t.name === "transform")!.call(result);
    }
    if (analysis.needs_validation) {
      result = this.tools.find((t) => t.name === "validate")!.call(result);
    }
    return result;
  }

  async analyzeAndProcess(data: string, fileName: string, tags?: string) {
    const analysis = await this.analyzeData(data);
    const processedData = await this.executeActions(data, analysis);

    // Guardar en DB usando saveProcessedFile
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
    title: string;             // p.ej. nombre original del archivo
    content: string;           // el texto procesado que guardaremos
    tags?: string;             // tags opcionales (comma-separated)
  }) {
    const entity = this.knowledgeBaseRepository.create({
      title: params.title,
      content: params.content,
      tags: params.tags,
    });
    const saved = await this.knowledgeBaseRepository.save(entity);
    return saved; // contiene id, createdAt, etc.
  }

  
   async loadContext(recordId: string) {
    const record = await this.knowledgeBaseRepository.findOne({
      where: { id: recordId },
    });
    if (!record) throw new Error(`No context found for id=${recordId}`);
    return record; // title, content, tags, createdAt
  }
  
}

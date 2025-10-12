import { Injectable } from '@nestjs/common';
import { Ollama } from '@langchain/ollama';
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";

@Injectable()
export class DataAgentService {
  private readonly model: ChatOllama;
  private readonly chain: RunnableSequence;

  constructor() {
    this.model = new ChatOllama({
      baseUrl: 'http://localhost:11434', // Container port
      model: 'llama3', // or 'mistral', 'phi3', etc.
      temperature: 0,
    });

    const outputSchema = z.object({
      needs_cleaning: z.boolean(),
      needs_transformation: z.boolean(),
      needs_validation: z.boolean(),
      explanation: z.string(),
    });

    const parser = StructuredOutputParser.fromZodSchema(outputSchema);

    const prompt = ChatPromptTemplate.fromTemplate(`

      You are a specialized assistant in corporate data analysis.
      Analyze the provided data and determine if it requires:
      - cleaning
      - transformation
      - validation

      Return ONLY a JSON with this exact structure:
      ${parser.getFormatInstructions()}

      Data:
      {data}
    `);

    this.chain = RunnableSequence.from([prompt, this.model, parser]);
  }
  async analyzeData(data: string) {
      const result = await this.chain.invoke({ data });
      try {
        return JSON.parse(result.content);
      } catch {
        return { raw: result.content };
      }
    }

  
}

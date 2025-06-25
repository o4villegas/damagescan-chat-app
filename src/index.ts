/**
 * AutoRAG Chat Application Backend
 * 
 * Implements Option B: Custom AutoRAG + LLM Pipeline
 * Workflow: Query → AutoRAG Search → Context Building → Enhanced System Prompt → LLM Generation → Streamed Response
 *
 * @license MIT
 */

import {
  Env,
  ChatMessage,
  ChatRequest,
  SearchOptions,
  SearchResponse,
  SearchResult,
  RAGContext,
  EnhancedSystemPrompt,
  ProcessingError,
  RequestContext,
  ChatResponseMetadata,
  ValidationResult,
  DEFAULT_CONFIG,
  ERROR_MESSAGES,
  isChatRequest,
  isSearchResult,
  isErrorResponse,
} from "./types";

// Application configuration
const CONFIG = {
  ...DEFAULT_CONFIG,
  // Override any defaults here if needed
};

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return createCORSResponse();
    }

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API Routes
    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return handleChatRequest(request, env, ctx);
      }
      return createErrorResponse("Method not allowed", 405);
    }

    // Handle 404 for unmatched routes
    return createErrorResponse("Not found", 404);
  },
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests with AutoRAG + LLM pipeline
 */
async function handleChatRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const startTime = Date.now();
  const requestId = generateRequestId();
  
  try {
    // Parse and validate request
    const body = await request.json();
    const validation = validateChatRequest(body);
    
    if (!validation.valid) {
      console.error(`[${requestId}] Validation failed:`, validation.errors);
      return createErrorResponse(
        `Invalid request: ${validation.errors.join(", ")}`,
        400
      );
    }

    const chatRequest = validation.sanitizedInput!;
    const requestContext: RequestContext = {
      userMessage: getUserMessage(chatRequest.messages),
      systemPrompt: chatRequest.systemPrompt,
      ragSettings: {
        ...CONFIG.ragSettings,
        ...chatRequest.ragSettings,
        index: CONFIG.autoragIndex,
      },
      startTime,
      requestId,
    };

    console.log(`[${requestId}] Processing chat request:`, {
      userMessage: requestContext.userMessage.substring(0, 100) + "...",
      hasSystemPrompt: !!requestContext.systemPrompt,
      ragSettings: requestContext.ragSettings,
    });

    // Execute the AutoRAG + LLM pipeline
    const response = await processAutoRAGPipeline(
      chatRequest,
      requestContext,
      env
    );

    return response;

  } catch (error) {
    console.error(`[${requestId}] Fatal error in chat request:`, error);
    
    const processingError: ProcessingError = {
      stage: "validation",
      message: error instanceof Error ? error.message : "Unknown error",
      details: error instanceof Error ? error.stack : undefined,
      context: {
        userMessage: "Unknown",
        ragSettings: CONFIG.ragSettings,
        startTime,
        requestId,
      },
      recoverable: false,
    };

    return createErrorResponse(
      "Internal server error occurred",
      500,
      processingError
    );
  }
}

/**
 * Main AutoRAG + LLM processing pipeline
 */
async function processAutoRAGPipeline(
  chatRequest: ChatRequest,
  context: RequestContext,
  env: Env
): Promise<Response> {
  const { requestId } = context;
  
  try {
    // Step 1: Search AutoRAG for relevant context
    console.log(`[${requestId}] Step 1: Searching AutoRAG...`);
    const ragSearchStart = Date.now();
    
    const ragContext = await searchAutoRAG(
      context.userMessage,
      context.ragSettings,
      env
    );
    
    const ragSearchTime = Date.now() - ragSearchStart;
    console.log(`[${requestId}] AutoRAG search completed in ${ragSearchTime}ms`, {
      documentsFound: ragContext.documentCount,
      averageScore: ragContext.averageScore,
      hasContext: ragContext.hasContext,
    });

    // Step 2: Build enhanced system prompt with RAG context
    console.log(`[${requestId}] Step 2: Building enhanced system prompt...`);
    const contextBuildStart = Date.now();
    
    const enhancedPrompt = buildEnhancedSystemPrompt({
      basePrompt: context.systemPrompt || CONFIG.defaultSystemPrompt,
      ragContext,
      includeInstructions: true,
    });
    
    const contextBuildTime = Date.now() - contextBuildStart;
    console.log(`[${requestId}] System prompt enhanced in ${contextBuildTime}ms`, {
      hasRAGContext: enhancedPrompt.hasRAGContext,
      tokenEstimate: enhancedPrompt.tokenEstimate,
    });

    // Step 3: Prepare messages for LLM
    const enhancedMessages: ChatMessage[] = [
      { role: "system", content: enhancedPrompt.prompt },
      ...chatRequest.messages.filter(msg => msg.role !== "system")
    ];

    // Step 4: Generate response using LLM with enhanced context
    console.log(`[${requestId}] Step 3: Generating LLM response...`);
    const llmStart = Date.now();
    
    const response = await generateLLMResponse(
      enhancedMessages,
      context,
      env
    );
    
    const llmTime = Date.now() - llmStart;
    console.log(`[${requestId}] LLM generation completed in ${llmTime}ms`);

    // Add performance headers
    const headers = new Headers(response.headers);
    headers.set("X-Processing-Time", `${Date.now() - context.startTime}ms`);
    headers.set("X-RAG-Documents", ragContext.documentCount.toString());
    headers.set("X-RAG-Average-Score", ragContext.averageScore.toFixed(3));
    headers.set("X-Request-ID", requestId);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

  } catch (error) {
    console.error(`[${requestId}] Pipeline error:`, error);
    
    const processingError: ProcessingError = {
      stage: "llm",
      message: error instanceof Error ? error.message : "Pipeline processing failed",
      details: error instanceof Error ? error.stack : undefined,
      context,
      recoverable: true,
      fallbackAction: "Use general knowledge without RAG context",
    };

    // Try fallback: Generate response without RAG context
    return handlePipelineFailure(chatRequest, processingError, env);
  }
}

/**
 * Search AutoRAG for relevant context
 */
async function searchAutoRAG(
  query: string,
  ragSettings: any,
  env: Env
): Promise<RAGContext> {
  try {
    const searchOptions: SearchOptions = {
      query,
      max_num_results: ragSettings.maxResults,
      ranking_options: {
        score_threshold: ragSettings.scoreThreshold,
      },
      rewrite_query: ragSettings.rewriteQuery,
    };

    console.log("AutoRAG search options:", searchOptions);

    const searchResult = await env.AI.autorag(ragSettings.index).search(searchOptions);
    
    console.log("AutoRAG search raw result:", {
      resultType: typeof searchResult,
      hasData: !!searchResult?.data,
      dataLength: searchResult?.data?.length || 0,
    });

    if (!searchResult || !searchResult.data || !Array.isArray(searchResult.data)) {
      console.warn("AutoRAG returned invalid response structure:", searchResult);
      return createEmptyRAGContext();
    }

    return buildRAGContext(searchResult);

  } catch (error) {
    console.error("AutoRAG search failed:", error);
    
    // Return empty context instead of throwing
    return createEmptyRAGContext();
  }
}

/**
 * Build RAG context from search results
 */
function buildRAGContext(searchResult: SearchResponse): RAGContext {
  const documents = searchResult.data;
  
  if (!documents || documents.length === 0) {
    return createEmptyRAGContext();
  }

  // Extract text content from each document
  const contextParts: string[] = [];
  const sources: Array<{ filename: string; score: number; relevantText: string }> = [];
  let totalScore = 0;

  documents.forEach((doc, index) => {
    if (!isSearchResult(doc)) {
      console.warn("Invalid search result structure:", doc);
      return;
    }

    // Extract text from content array
    const textContent = doc.content
      .filter(content => content.type === "text")
      .map(content => content.text)
      .join('\n')
      .trim();

    if (textContent) {
      const contextEntry = `[Document ${index + 1}: ${doc.filename} (Relevance: ${doc.score.toFixed(2)})]\n${textContent}`;
      contextParts.push(contextEntry);

      sources.push({
        filename: doc.filename,
        score: doc.score,
        relevantText: textContent.substring(0, 200) + (textContent.length > 200 ? "..." : ""),
      });

      totalScore += doc.score;
    }
  });

  const contextText = contextParts.join('\n\n');
  const averageScore = documents.length > 0 ? totalScore / documents.length : 0;

  return {
    contextText,
    documentCount: documents.length,
    averageScore,
    sources,
    hasContext: contextText.length > 0,
  };
}

/**
 * Create empty RAG context for fallback scenarios
 */
function createEmptyRAGContext(): RAGContext {
  return {
    contextText: "",
    documentCount: 0,
    averageScore: 0,
    sources: [],
    hasContext: false,
  };
}

/**
 * Build enhanced system prompt with RAG context
 */
function buildEnhancedSystemPrompt(config: {
  basePrompt: string;
  ragContext: RAGContext;
  includeInstructions: boolean;
}): EnhancedSystemPrompt {
  const { basePrompt, ragContext, includeInstructions } = config;

  if (!ragContext.hasContext) {
    return {
      prompt: basePrompt,
      hasRAGContext: false,
      contextSummary: "No relevant documents found in knowledge base",
      tokenEstimate: estimateTokens(basePrompt),
    };
  }

  const contextSummary = `Found ${ragContext.documentCount} relevant documents (avg. relevance: ${ragContext.averageScore.toFixed(2)})`;
  
  const enhancedPrompt = `${basePrompt}

KNOWLEDGE BASE CONTEXT:
You have access to relevant information from the knowledge base. ${contextSummary}:

${ragContext.contextText}

INSTRUCTIONS:
- When the knowledge base context is relevant to the user's question, prioritize this information
- Reference specific documents when using knowledge base information (e.g., "according to [Document 1: filename]")
- If the knowledge base doesn't contain relevant information for the question, rely on your general knowledge
- Be clear about when you're using knowledge base information vs. general knowledge
- Provide accurate and helpful responses based on the best available information`;

  return {
    prompt: enhancedPrompt,
    hasRAGContext: true,
    contextSummary,
    tokenEstimate: estimateTokens(enhancedPrompt),
  };
}

/**
 * Generate LLM response with enhanced context
 */
async function generateLLMResponse(
  messages: ChatMessage[],
  context: RequestContext,
  env: Env
): Promise<Response> {
  try {
    const response = await env.AI.run(
      CONFIG.model,
      {
        messages,
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
        stream: true,
      },
      {
        returnRawResponse: true,
      }
    );

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    // Return streaming response with CORS headers
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });

  } catch (error) {
    console.error(`[${context.requestId}] LLM generation failed:`, error);
    throw error;
  }
}

/**
 * Handle pipeline failures with fallback strategies
 */
async function handlePipelineFailure(
  chatRequest: ChatRequest,
  error: ProcessingError,
  env: Env
): Promise<Response> {
  console.log(`[${error.context.requestId}] Attempting fallback strategy...`);

  try {
    // Fallback: Use basic system prompt without RAG context
    const fallbackMessages: ChatMessage[] = [
      { 
        role: "system", 
        content: error.context.systemPrompt || CONFIG.defaultSystemPrompt 
      },
      ...chatRequest.messages.filter(msg => msg.role !== "system")
    ];

    const fallbackResponse = await env.AI.run(
      CONFIG.model,
      {
        messages: fallbackMessages,
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
        stream: true,
      },
      {
        returnRawResponse: true,
      }
    );

    if (!fallbackResponse.ok) {
      throw new Error(`Fallback LLM also failed: ${fallbackResponse.status}`);
    }

    // Add fallback headers
    const headers = new Headers(fallbackResponse.headers);
    headers.set("X-Fallback-Used", "true");
    headers.set("X-Original-Error", error.message);
    headers.set("X-Request-ID", error.context.requestId);
    addCORSHeaders(headers);

    return new Response(fallbackResponse.body, {
      status: fallbackResponse.status,
      headers,
    });

  } catch (fallbackError) {
    console.error(`[${error.context.requestId}] Fallback also failed:`, fallbackError);
    
    return createErrorResponse(
      ERROR_MESSAGES.LLM_FAILURE,
      503,
      {
        ...error,
        fallbackError: fallbackError instanceof Error ? fallbackError.message : "Unknown fallback error",
      }
    );
  }
}

/**
 * Validate chat request structure and content
 */
function validateChatRequest(body: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isChatRequest(body)) {
    errors.push("Invalid request structure");
    return { valid: false, errors, warnings };
  }

  // Validate messages
  if (body.messages.length === 0) {
    errors.push("At least one message is required");
  }

  // Check for user message
  const hasUserMessage = body.messages.some(msg => msg.role === "user");
  if (!hasUserMessage) {
    errors.push("At least one user message is required");
  }

  // Validate system prompt length
  if (body.systemPrompt && body.systemPrompt.length > 10000) {
    errors.push("System prompt too long (max 10000 characters)");
  }

  // Validate message content length
  for (const msg of body.messages) {
    if (msg.content.length > 50000) {
      errors.push(`Message content too long (max 50000 characters)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedInput: errors.length === 0 ? body : undefined,
  };
}

/**
 * Utility functions
 */
function getUserMessage(messages: ChatMessage[]): string {
  const userMessages = messages.filter(msg => msg.role === "user");
  return userMessages[userMessages.length - 1]?.content || "";
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

function createCORSResponse(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function addCORSHeaders(headers: Headers): void {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
}

function createErrorResponse(
  message: string,
  status: number = 500,
  details?: any
): Response {
  const response = {
    error: message,
    details: details ? JSON.stringify(details, null, 2) : undefined,
    timestamp: new Date().toISOString(),
  };

  const headers = new Headers({
    "Content-Type": "application/json",
  });
  addCORSHeaders(headers);

  return new Response(JSON.stringify(response), {
    status,
    headers,
  });
}

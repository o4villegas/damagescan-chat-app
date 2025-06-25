/**
 * Complete type definitions for the AutoRAG Chat Cloudflare Worker.
 * Updated for Option B: Custom AutoRAG + LLM Pipeline Implementation
 */

export interface Env {
  /**
   * Binding for the Workers AI API, including AutoRAG and chat.
   */
  AI: Ai;

  /**
   * Binding for static assets.
   */
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

/**
 * Interface for chat messages
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Interface for chat request body
 */
export interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  ragSettings?: {
    maxResults?: number;
    scoreThreshold?: number;
    rewriteQuery?: boolean;
  };
}

/**
 * Interface for the Workers AI binding with AutoRAG support.
 */
export interface Ai {
  /**
   * Entry point for accessing a specific AutoRAG index.
   */
  autorag(index: string): {
    /**
     * Executes a retrieval-augmented generation (RAG) query using the given options.
     */
    aiSearch(opts: AiSearchOptions): Promise<AiSearchResponse>;

    /**
     * Retrieves relevant chunks only (no LLM response).
     */
    search(opts: SearchOptions): Promise<SearchResponse>;
  };

  /**
   * Run standard AI models
   */
  run(
    model: string,
    options: {
      messages?: ChatMessage[];
      max_tokens?: number;
      temperature?: number;
      stream?: boolean;
      [key: string]: any;
    },
    config?: {
      returnRawResponse?: boolean;
      gateway?: {
        id: string;
        skipCache?: boolean;
        cacheTtl?: number;
      };
    }
  ): Promise<any>;
}

/**
 * Options for aiSearch, which retrieves documents and generates an LLM response.
 */
export interface AiSearchOptions {
  query: string;
  model?: string;
  rewrite_query?: boolean;
  max_num_results?: number;
  ranking_options?: {
    score_threshold?: number;
    rerank?: boolean;
  };
  stream?: boolean;
  filters?: Record<string, unknown>;
  metadata_fields?: string[];
}

/**
 * Options for raw search (retrieval only).
 */
export interface SearchOptions {
  query: string;
  max_num_results?: number;
  filters?: Record<string, unknown>;
  ranking_options?: {
    score_threshold?: number;
    rerank?: boolean;
  };
  metadata_fields?: string[];
  rewrite_query?: boolean;
}

/**
 * A single document chunk returned from RAG.
 */
export interface SearchResult {
  file_id: string;
  filename: string;
  score: number;
  attributes: {
    folder?: string;
    timestamp?: number;
    modified_date?: number;
    [key: string]: string | number | boolean | null | undefined;
  };
  content: Array<{
    id: string;
    type: "text";
    text: string;
  }>;
  chunk_id?: string;
  document_id?: string;
  page_number?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Response from aiSearch: includes generated response and supporting docs.
 */
export interface AiSearchResponse {
  object: "vector_store.search_results.page";
  search_query: string;
  response: string;
  data: SearchResult[];
  has_more: boolean;
  next_page: string | null;
  model_used?: string;
  query_rewritten?: string;
  total_results?: number;
}

/**
 * Response from raw search (no LLM generation).
 */
export interface SearchResponse {
  object: "vector_store.search_results.page";
  search_query: string;
  data: SearchResult[];
  has_more: boolean;
  next_page: string | null;
  query_rewritten?: string;
  total_results?: number;
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  error: string;
  details?: string;
  code?: string;
  message?: string;
}

/**
 * Streaming response chunk from Workers AI
 */
export interface StreamingChunk {
  response?: string;
  done?: boolean;
  error?: string;
  token?: string;
  finish_reason?: string;
}

/**
 * Enhanced message with metadata for internal processing
 */
export interface EnhancedMessage extends ChatMessage {
  timestamp?: string;
  ragContext?: SearchResult[];
  ragContextCount?: number;
  hasKnowledgeBase?: boolean;
}

/**
 * Configuration for RAG retrieval settings
 */
export interface RAGConfig {
  index: string;
  maxResults: number;
  scoreThreshold: number;
  rewriteQuery: boolean;
  model?: string;
}

/**
 * Context building result for LLM enhancement
 */
export interface RAGContext {
  contextText: string;
  documentCount: number;
  averageScore: number;
  sources: Array<{
    filename: string;
    score: number;
    relevantText: string;
  }>;
  hasContext: boolean;
}

/**
 * System prompt building options
 */
export interface SystemPromptConfig {
  basePrompt: string;
  ragContext?: RAGContext;
  includeInstructions: boolean;
  customInstructions?: string;
}

/**
 * Enhanced system prompt result
 */
export interface EnhancedSystemPrompt {
  prompt: string;
  hasRAGContext: boolean;
  contextSummary: string;
  tokenEstimate: number;
}

/**
 * Chat response metadata
 */
export interface ChatResponseMetadata {
  ragUsed: boolean;
  documentsFound: number;
  averageRelevanceScore: number;
  modelUsed: string;
  processingTimeMs: number;
  tokensGenerated?: number;
  sources?: Array<{
    filename: string;
    score: number;
  }>;
}

/**
 * Complete chat response structure
 */
export interface ChatResponse {
  content: string;
  metadata: ChatResponseMetadata;
  timestamp: string;
  success: boolean;
  error?: string;
}

/**
 * Request processing context for error handling
 */
export interface RequestContext {
  userMessage: string;
  systemPrompt?: string;
  ragSettings: RAGConfig;
  startTime: number;
  requestId: string;
}

/**
 * AutoRAG search failure information
 */
export interface RAGFailure {
  attempted: boolean;
  error: string;
  fallbackUsed: boolean;
  query?: string;
}

/**
 * LLM processing failure information
 */
export interface LLMFailure {
  attempted: boolean;
  error: string;
  modelUsed?: string;
  inputTokens?: number;
}

/**
 * Comprehensive error context for debugging
 */
export interface ProcessingError {
  stage: "autorag" | "llm" | "context_building" | "system_prompt" | "streaming" | "validation";
  message: string;
  details?: string;
  ragFailure?: RAGFailure;
  llmFailure?: LLMFailure;
  context: RequestContext;
  recoverable: boolean;
  fallbackAction?: string;
}

/**
 * Validation result for user inputs
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedInput?: ChatRequest;
}

/**
 * Performance metrics for monitoring
 */
export interface PerformanceMetrics {
  totalRequestTime: number;
  autoragSearchTime: number;
  contextBuildingTime: number;
  llmGenerationTime: number;
  streamingTime: number;
  tokensGenerated: number;
  documentsRetrieved: number;
  cacheHit: boolean;
}

/**
 * Frontend configuration for system prompt management
 */
export interface SystemPromptPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
  category: "default" | "technical" | "creative" | "analytical" | "custom";
}

/**
 * UI state for chat interface
 */
export interface ChatUIState {
  isProcessing: boolean;
  connectionStatus: "connected" | "disconnected" | "connecting";
  ragEnabled: boolean;
  systemPromptExpanded: boolean;
  currentTheme: "light" | "dark";
  messageCount: number;
  lastActivity: number;
}

/**
 * Frontend message display with enhanced metadata
 */
export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  metadata?: {
    ragUsed?: boolean;
    documentsCount?: number;
    averageScore?: number;
    sources?: Array<{
      filename: string;
      score: number;
    }>;
    processingTime?: number;
    error?: string;
  };
  status: "sending" | "processing" | "complete" | "error";
}

/**
 * Configuration for the chat application
 */
export interface ChatAppConfig {
  model: string;
  autoragIndex: string;
  defaultSystemPrompt: string;
  maxTokens: number;
  temperature: number;
  ragSettings: {
    maxResults: number;
    scoreThreshold: number;
    rewriteQuery: boolean;
  };
  streamingEnabled: boolean;
  errorRetryAttempts: number;
  timeoutMs: number;
}

/**
 * Type guards for runtime type checking
 */
export function isChatRequest(obj: any): obj is ChatRequest {
  return (
    obj &&
    typeof obj === "object" &&
    Array.isArray(obj.messages) &&
    obj.messages.every((msg: any) => 
      msg &&
      typeof msg.role === "string" &&
      ["system", "user", "assistant"].includes(msg.role) &&
      typeof msg.content === "string"
    )
  );
}

export function isSearchResult(obj: any): obj is SearchResult {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.file_id === "string" &&
    typeof obj.filename === "string" &&
    typeof obj.score === "number" &&
    Array.isArray(obj.content) &&
    obj.content.every((content: any) => 
      content &&
      typeof content.type === "string" &&
      typeof content.text === "string"
    )
  );
}

export function isErrorResponse(obj: any): obj is ErrorResponse {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.error === "string"
  );
}

/**
 * Utility types for better type inference
 */
export type AsyncResult<T> = Promise<T | ErrorResponse>;
export type OptionalRAGSettings = Partial<RAGConfig>;
export type MessageRole = ChatMessage["role"];
export type ProcessingStage = ProcessingError["stage"];
export type UITheme = ChatUIState["currentTheme"];
export type ConnectionStatus = ChatUIState["connectionStatus"];
export type MessageStatus = DisplayMessage["status"];
export type PromptCategory = SystemPromptPreset["category"];

/**
 * Constants for configuration
 */
export const DEFAULT_CONFIG: ChatAppConfig = {
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  autoragIndex: "damagescan-rag-1",
  defaultSystemPrompt: "You are a helpful, friendly assistant. Use the provided context from the knowledge base to enhance your responses when relevant, but you can also draw from your general knowledge. If context is provided, prioritize it but explain clearly when you're using external knowledge vs. the knowledge base. Provide concise and accurate responses.",
  maxTokens: 1024,
  temperature: 0.7,
  ragSettings: {
    maxResults: 5,
    scoreThreshold: 0.1,
    rewriteQuery: true,
  },
  streamingEnabled: true,
  errorRetryAttempts: 3,
  timeoutMs: 30000,
};

export const ERROR_MESSAGES = {
  AUTORAG_UNAVAILABLE: "Knowledge base temporarily unavailable. Using general knowledge only.",
  LLM_FAILURE: "AI model temporarily unavailable. Please try again.",
  INVALID_REQUEST: "Invalid request format. Please check your input.",
  RATE_LIMITED: "Too many requests. Please wait a moment before trying again.",
  TIMEOUT: "Request timed out. Please try again with a shorter message.",
  NETWORK_ERROR: "Network error occurred. Please check your connection.",
  UNKNOWN_ERROR: "An unexpected error occurred. Please try again.",
} as const;

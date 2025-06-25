/**
 * DamageScan_Chat Frontend Application
 * 
 * Vanilla JavaScript implementation for browser environment.
 * Handles UI interactions, system prompt configuration,
 * and communication with the AutoRAG-enhanced backend API.
 * 
 * Features:
 * - System prompt configuration with presets
 * - Real-time chat with streaming responses
 * - RAG status indicators and metadata display
 * - Error handling and connection management
 * - Mobile-responsive interactions
 */

// =============================================================================
// Configuration Constants
// =============================================================================

const CONFIG = {
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

const ERROR_MESSAGES = {
  AUTORAG_UNAVAILABLE: "Knowledge base temporarily unavailable. Using general knowledge only.",
  LLM_FAILURE: "AI model temporarily unavailable. Please try again.",
  INVALID_REQUEST: "Invalid request format. Please check your input.",
  RATE_LIMITED: "Too many requests. Please wait a moment before trying again.",
  TIMEOUT: "Request timed out. Please try again with a shorter message.",
  NETWORK_ERROR: "Network error occurred. Please check your connection.",
  UNKNOWN_ERROR: "An unexpected error occurred. Please try again.",
};

// =============================================================================
// System Prompt Presets
// =============================================================================

const systemPromptPresets = {
  default: "You are a helpful, friendly assistant. Use the provided context from the knowledge base to enhance your responses when relevant, but you can also draw from your general knowledge. If context is provided, prioritize it but explain clearly when you're using external knowledge vs. the knowledge base. Provide concise and accurate responses.",
  
  technical: "You are a technical expert assistant. When using the knowledge base, focus on technical details, implementation specifics, and best practices. Provide code examples when relevant, explain technical concepts clearly, and reference specific documentation sections when using knowledge base information. Be precise and thorough in your explanations.",
  
  creative: "You are a creative and innovative assistant. Use the knowledge base information as inspiration while encouraging creative thinking and novel approaches. When drawing from the knowledge base, combine the information with creative insights and alternative perspectives. Be engaging and imaginative in your responses.",
  
  analytical: "You are an analytical assistant focused on data-driven insights. When using the knowledge base, emphasize facts, statistics, and logical reasoning. Break down complex information into clear analytical points, identify patterns and relationships, and provide structured, evidence-based responses."
};

// =============================================================================
// DOM Element References
// =============================================================================

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const systemPromptToggle = document.getElementById("system-prompt-toggle");
const systemPromptSection = document.getElementById("system-prompt-section");
const systemPromptInput = document.getElementById("system-prompt");
const charCount = document.getElementById("char-count");

// =============================================================================
// Application State
// =============================================================================

let chatHistory = [
  {
    role: "assistant",
    content: "Hello! I'm an AI assistant powered by Cloudflare Workers AI with AutoRAG integration. I can help you by searching our knowledge base and combining that with my general knowledge. How can I assist you today?",
    timestamp: new Date().toISOString(),
    metadata: {
      ragUsed: false,
      documentsCount: 0,
      sources: []
    }
  },
];

let isProcessing = false;
let messageIdCounter = 0;
let retryAttempts = 0;
const maxRetryAttempts = 3;

// =============================================================================
// Initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', function() {
  initializeSystemPrompt();
  initializeEventListeners();
  initializeUIState();
  
  console.log("DamageScan_Chat initialized successfully");
});

/**
 * Initialize system prompt functionality
 */
function initializeSystemPrompt() {
  const savedSystemPrompt = localStorage.getItem("systemPrompt");
  if (savedSystemPrompt) {
    systemPromptInput.value = savedSystemPrompt;
  } else {
    systemPromptInput.value = CONFIG.defaultSystemPrompt;
  }
  updateCharacterCount();
}

// =============================================================================
// Message Management
// =============================================================================

/**
 * Initialize all event listeners
 */
function initializeEventListeners() {
  // System prompt toggle
  systemPromptToggle.addEventListener("click", toggleSystemPromptSection);
  
  // System prompt input
  systemPromptInput.addEventListener("input", handleSystemPromptInput);
  systemPromptInput.addEventListener("input", updateCharacterCount);
  
  // Preset buttons
  document.querySelectorAll('.preset-button').forEach(button => {
    button.addEventListener("click", handlePresetSelection);
  });
  
  // User input
  userInput.addEventListener("input", handleUserInputChange);
  userInput.addEventListener("keydown", handleUserInputKeydown);
  
  // Send button
  sendButton.addEventListener("click", sendMessage);
  
  // Connection status monitoring
  window.addEventListener("online", handleConnectionRestore);
  window.addEventListener("offline", handleConnectionLoss);
}

/**
 * Initialize UI state
 */
function initializeUIState() {
  userInput.focus();
  scrollToBottom();
}

// =============================================================================
// System Prompt Management
// =============================================================================

/**
 * Toggle system prompt configuration section
 */
function toggleSystemPromptSection() {
  const isVisible = systemPromptSection.classList.contains("visible");
  
  if (isVisible) {
    systemPromptSection.classList.remove("visible");
    systemPromptToggle.innerHTML = '<span>⚙️</span><span>Configure Prompt</span>';
    systemPromptToggle.classList.remove("active");
  } else {
    systemPromptSection.classList.add("visible");
    systemPromptToggle.innerHTML = '<span>✖️</span><span>Hide Configuration</span>';
    systemPromptToggle.classList.add("active");
    systemPromptInput.focus();
  }
}

/**
 * Handle system prompt input changes
 */
function handleSystemPromptInput() {
  const currentValue = systemPromptInput.value;
  localStorage.setItem("systemPrompt", currentValue);
  
  // Add visual feedback for saving
  systemPromptInput.style.borderColor = "var(--success-color)";
  setTimeout(() => {
    systemPromptInput.style.borderColor = "";
  }, 1000);
}

/**
 * Update character count display
 */
function updateCharacterCount() {
  const length = systemPromptInput.value.length;
  const maxLength = 10000;
  charCount.textContent = length.toLocaleString();
  
  // Color coding for character count
  if (length > maxLength * 0.9) {
    charCount.style.color = "var(--error-color)";
  } else if (length > maxLength * 0.7) {
    charCount.style.color = "var(--warning-color)";
  } else {
    charCount.style.color = "var(--text-muted)";
  }
}

/**
 * Handle preset button selection
 */
function handlePresetSelection(event) {
  const presetName = event.target.dataset.preset;
  const presetPrompt = systemPromptPresets[presetName];
  
  if (presetPrompt) {
    systemPromptInput.value = presetPrompt;
    localStorage.setItem("systemPrompt", presetPrompt);
    updateCharacterCount();
    
    // Visual feedback
    event.target.style.background = "var(--primary-color)";
    event.target.style.color = "white";
    setTimeout(() => {
      event.target.style.background = "";
      event.target.style.color = "";
    }, 1000);
  }
}

// =============================================================================
// User Input Management
// =============================================================================

/**
 * Handle user input changes (auto-resize)
 */
function handleUserInputChange() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 150) + "px";
}

/**
 * Handle user input keydown events
 */
function handleUserInputKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

// =============================================================================
// Input Validation Functions
// =============================================================================

/**
 * Validate chat request structure
 */
function isChatRequest(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    Array.isArray(obj.messages) &&
    obj.messages.every((msg) => 
      msg &&
      typeof msg.role === "string" &&
      ["system", "user", "assistant"].includes(msg.role) &&
      typeof msg.content === "string"
    )
  );
}

/**
 * Validate chat request structure and content
 */
function validateChatRequest(body) {
  const errors = [];
  const warnings = [];

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
 * Send a message to the chat API and process the response
 */
async function sendMessage() {
  const message = userInput.value.trim();

  // Validate input
  if (message === "" || isProcessing) return;

  // Prepare for processing
  setProcessingState(true);
  const messageId = generateMessageId();
  
  // Add user message to chat
  addMessageToChat("user", message, {
    messageId,
    timestamp: new Date().toISOString()
  });

  // Clear and reset input
  userInput.value = "";
  userInput.style.height = "auto";
  
  // Show typing indicator
  showTypingIndicator();

  // Add to chat history
  chatHistory.push({ 
    role: "user", 
    content: message,
    timestamp: new Date().toISOString()
  });

  try {
    // Create assistant message container
    const assistantMessageId = generateMessageId();
    const assistantMessageEl = createAssistantMessageElement(assistantMessageId);
    
    // Send request to API
    const response = await sendChatRequest();
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Process streaming response
    await processStreamingResponse(response, assistantMessageEl, assistantMessageId);
    
    // Reset retry attempts on success
    retryAttempts = 0;

  } catch (error) {
    console.error("Chat request failed:", error);
    await handleChatError(error, messageId);
  } finally {
    hideTypingIndicator();
    setProcessingState(false);
  }
}

/**
 * Send chat request to backend API
 */
async function sendChatRequest() {
  const customSystemPrompt = systemPromptInput.value.trim();
  
  const requestBody = {
    messages: chatHistory,
    systemPrompt: customSystemPrompt || undefined,
    ragSettings: {
      ...CONFIG.ragSettings,
      index: CONFIG.autoragIndex,
    }
  };

  console.log("Sending chat request:", {
    messageCount: requestBody.messages.length,
    hasSystemPrompt: !!requestBody.systemPrompt,
    ragSettings: requestBody.ragSettings
  });

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  return response;
}

/**
 * Process streaming response from the API
 */
async function processStreamingResponse(response, messageElement, messageId) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let responseText = "";
  let hasContent = false;

  const contentEl = messageElement.querySelector(".message-content");
  const ragIndicator = messageElement.querySelector(".rag-indicator");
  
  // Update RAG indicator to processing state
  updateRAGIndicator(ragIndicator, "searching", "🧠 Processing with AI...");

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      // Decode chunk
      const chunk = decoder.decode(value, { stream: true });
      
      // Process each line in the chunk
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.trim() === "" || line.startsWith(":")) continue;

        try {
          let jsonData;
          
          // Handle Server-Sent Events format
          if (line.startsWith("data: ")) {
            jsonData = JSON.parse(line.substring(6));
          } else if (line.trim()) {
            // Try to parse as plain JSON
            jsonData = JSON.parse(line);
          } else {
            continue;
          }

          if (jsonData.response) {
            responseText += jsonData.response;
            contentEl.textContent = responseText;
            hasContent = true;
            scrollToBottom();
          }

        } catch (parseError) {
          console.warn("Failed to parse response chunk:", parseError, "Line:", line);
          // Try treating as plain text if JSON parsing fails
          if (line.trim() && !line.startsWith("data:") && !line.startsWith(":")) {
            responseText += line;
            contentEl.textContent = responseText;
            hasContent = true;
            scrollToBottom();
          }
        }
      }
    }

    // Process response metadata from headers
    const metadata = extractResponseMetadata(response);
    updateMessageWithMetadata(messageElement, metadata);
    
    // Update RAG indicator based on metadata
    if (metadata.ragUsed && metadata.documentsFound > 0) {
      updateRAGIndicator(ragIndicator, "found", 
        `✅ Enhanced with ${metadata.documentsFound} document${metadata.documentsFound !== 1 ? 's' : ''} (avg. relevance: ${metadata.averageScore?.toFixed(2) || 'N/A'})`
      );
    } else {
      updateRAGIndicator(ragIndicator, "not-found", "⚠️ Using general knowledge (no relevant documents found)");
    }

    // Add to chat history
    if (responseText) {
      chatHistory.push({ 
        role: "assistant", 
        content: responseText,
        timestamp: new Date().toISOString(),
        metadata
      });
    }

    if (!hasContent) {
      throw new Error("No response content received");
    }

  } catch (streamError) {
    console.error("Streaming error:", streamError);
    updateRAGIndicator(ragIndicator, "error", "❌ Error processing response");
    throw streamError;
  }
}

/**
 * Extract response metadata from headers
 */
function extractResponseMetadata(response) {
  const headers = response.headers;
  
  return {
    ragUsed: headers.get("X-RAG-Documents") !== "0",
    documentsFound: parseInt(headers.get("X-RAG-Documents") || "0"),
    averageScore: parseFloat(headers.get("X-RAG-Average-Score") || "0"),
    processingTime: headers.get("X-Processing-Time"),
    requestId: headers.get("X-Request-ID"),
    fallbackUsed: headers.get("X-Fallback-Used") === "true"
  };
}

/**
 * Create assistant message element
 */
function createAssistantMessageElement(messageId) {
  const messageEl = document.createElement("div");
  messageEl.className = "message assistant-message";
  messageEl.dataset.messageId = messageId;
  
  const timestamp = new Date().toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  messageEl.innerHTML = `
    <div class="message-header">
      <span class="message-role">Assistant</span>
      <span class="message-timestamp">${timestamp}</span>
    </div>
    <div class="message-content"></div>
    <div class="rag-indicator searching">
      <span>🔍</span>
      <span>Searching knowledge base...</span>
    </div>
    <div class="message-metadata" style="display: none;">
      <div class="metadata-item">
        <span class="metadata-icon">📄</span>
        <span class="document-count">0 documents</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-icon">⚡</span>
        <span class="processing-time">0ms</span>
      </div>
    </div>
  `;
  
  chatMessages.appendChild(messageEl);
  scrollToBottom();
  
  return messageEl;
}

/**
 * Update message with metadata
 */
function updateMessageWithMetadata(messageElement, metadata) {
  const metadataEl = messageElement.querySelector(".message-metadata");
  const documentCountEl = messageElement.querySelector(".document-count");
  const processingTimeEl = messageElement.querySelector(".processing-time");
  
  if (metadata.documentsFound > 0) {
    documentCountEl.textContent = `${metadata.documentsFound} document${metadata.documentsFound !== 1 ? 's' : ''}`;
    metadataEl.style.display = "flex";
  }
  
  if (metadata.processingTime) {
    processingTimeEl.textContent = metadata.processingTime;
    metadataEl.style.display = "flex";
  }
  
  if (metadata.fallbackUsed) {
    const fallbackIndicator = document.createElement("div");
    fallbackIndicator.className = "metadata-item";
    fallbackIndicator.innerHTML = `
      <span class="metadata-icon">⚠️</span>
      <span>Fallback mode used</span>
    `;
    metadataEl.appendChild(fallbackIndicator);
    metadataEl.style.display = "flex";
  }
}

/**
 * Update RAG indicator status
 */
function updateRAGIndicator(indicator, status, text) {
  if (!indicator) return;
  
  indicator.className = `rag-indicator ${status}`;
  indicator.innerHTML = text;
}

/**
 * Add message to chat display
 */
function addMessageToChat(role, content, options = {}) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}-message`;
  
  if (options.messageId) {
    messageEl.dataset.messageId = options.messageId;
  }
  
  const timestamp = options.timestamp 
    ? new Date(options.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const roleName = role === "user" ? "You" : "Assistant";
  
  messageEl.innerHTML = `
    <div class="message-header">
      <span class="message-role">${roleName}</span>
      <span class="message-timestamp">${timestamp}</span>
    </div>
    <div class="message-content">${content}</div>
  `;
  
  chatMessages.appendChild(messageEl);
  scrollToBottom();
  
  return messageEl;
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Handle chat request errors
 */
async function handleChatError(error, messageId) {
  console.error(`Chat error (attempt ${retryAttempts + 1}):`, error);
  
  let errorMessage = ERROR_MESSAGES.UNKNOWN_ERROR;
  let shouldRetry = false;
  
  // Determine error type and appropriate response
  if (error.message.includes("HTTP 503") || error.message.includes("HTTP 502")) {
    errorMessage = ERROR_MESSAGES.LLM_FAILURE;
    shouldRetry = true;
  } else if (error.message.includes("HTTP 429")) {
    errorMessage = ERROR_MESSAGES.RATE_LIMITED;
    shouldRetry = true;
  } else if (error.message.includes("NetworkError") || error.message.includes("Failed to fetch")) {
    errorMessage = ERROR_MESSAGES.NETWORK_ERROR;
    shouldRetry = true;
  } else if (error.message.includes("timeout")) {
    errorMessage = ERROR_MESSAGES.TIMEOUT;
    shouldRetry = false;
  }
  
  // Show error message
  addMessageToChat("assistant", errorMessage, {
    messageId: generateMessageId(),
    timestamp: new Date().toISOString()
  });
  
  // Handle retry logic
  if (shouldRetry && retryAttempts < maxRetryAttempts) {
    retryAttempts++;
    console.log(`Preparing retry attempt ${retryAttempts}...`);
    
    // Show retry message
    setTimeout(() => {
      addMessageToChat("assistant", `Retrying... (attempt ${retryAttempts} of ${maxRetryAttempts})`, {
        messageId: generateMessageId(),
        timestamp: new Date().toISOString()
      });
    }, 1000);
    
    // Retry after delay
    setTimeout(() => {
      sendMessage();
    }, 2000 * retryAttempts); // Exponential backoff
  } else {
    retryAttempts = 0;
  }
}

/**
 * Handle connection loss
 */
function handleConnectionLoss() {
  console.log("Connection lost");
  
  if (isProcessing) {
    addMessageToChat("assistant", "Connection lost. Please check your internet connection and try again.", {
      messageId: generateMessageId(),
      timestamp: new Date().toISOString()
    });
    
    setProcessingState(false);
    hideTypingIndicator();
  }
  
  // Update status indicator
  const statusIndicator = document.querySelector('.status-indicator');
  if (statusIndicator) {
    statusIndicator.style.background = "var(--error-color)";
  }
}

/**
 * Handle connection restoration
 */
function handleConnectionRestore() {
  console.log("Connection restored");
  
  // Update status indicator
  const statusIndicator = document.querySelector('.status-indicator');
  if (statusIndicator) {
    statusIndicator.style.background = "var(--success-color)";
  }
}

// =============================================================================
// UI State Management
// =============================================================================

/**
 * Set processing state
 */
function setProcessingState(processing) {
  isProcessing = processing;
  userInput.disabled = processing;
  sendButton.disabled = processing;
  
  if (processing) {
    sendButton.innerHTML = '<span>Sending...</span>';
  } else {
    sendButton.innerHTML = `
      <span>Send</span>
      <svg class="send-button-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M15.854 7.146a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708-.708L14.293 8H.5a.5.5 0 0 1 0-1h13.793L8.146.854a.5.5 0 1 1 .708-.708l7 7z"/>
      </svg>
    `;
    userInput.focus();
  }
}

/**
 * Show typing indicator
 */
function showTypingIndicator() {
  typingIndicator.classList.add("visible");
  scrollToBottom();
}

/**
 * Hide typing indicator
 */
function hideTypingIndicator() {
  typingIndicator.classList.remove("visible");
}

/**
 * Scroll to bottom of chat
 */
function scrollToBottom() {
  requestAnimationFrame(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate unique message ID
 */
function generateMessageId() {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

/**
 * Log performance metrics
 */
function logPerformanceMetrics(metadata) {
  if (metadata.processingTime && metadata.documentsFound !== undefined) {
    console.log("Chat Performance:", {
      processingTime: metadata.processingTime,
      documentsFound: metadata.documentsFound,
      averageScore: metadata.averageScore,
      ragUsed: metadata.ragUsed,
      fallbackUsed: metadata.fallbackUsed || false
    });
  }
}

// =============================================================================
// Application Health Monitoring
// =============================================================================

/**
 * Monitor application health
 */
setInterval(() => {
  // Check if critical elements are still present
  if (!userInput || !sendButton || !chatMessages) {
    console.error("Critical DOM elements missing, attempting recovery...");
    location.reload();
  }
  
  // Clean up old messages if chat gets too long (performance optimization)
  const messages = chatMessages.querySelectorAll('.message');
  if (messages.length > 100) {
    console.log("Cleaning up old messages for performance...");
    // Remove older user messages to free up memory
    const userMessages = chatMessages.querySelectorAll('.user-message');
    for (let i = 0; i < Math.min(20, userMessages.length - 10); i++) {
      if (userMessages[i]) {
        userMessages[i].remove();
      }
    }
  }
}, 30000); // Check every 30 seconds

// =============================================================================
// Export for debugging (development only)
// =============================================================================

if (typeof window !== 'undefined') {
  window.chatDebug = {
    chatHistory,
    isProcessing,
    retryAttempts,
    sendMessage,
    systemPromptPresets,
    CONFIG,
    clearChat: () => {
      chatHistory.length = 1; // Keep initial message
      chatMessages.innerHTML = chatMessages.querySelector('.message').outerHTML;
    }
  };
}

console.log("DamageScan_Chat JavaScript loaded successfully");

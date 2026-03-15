/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                  ResumeAI — app.js                              ║
 * ║         AI Resume & Cover Letter Tailor                         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ─── API KEY SETUP GUIDE ────────────────────────────────────────────
 *
 * OPTION 1 — Netlify (Recommended for production)
 *   1. Go to Site Settings → Environment Variables
 *   2. Add: GROQ_API_KEY = gsk_your_actual_key_here
 *   3. Create a Netlify Function at /netlify/functions/groq-proxy.js
 *      to forward requests (keeps the key server-side)
 *
 * OPTION 2 — Vercel
 *   1. Go to Project Settings → Environment Variables
 *   2. Add: GROQ_API_KEY = gsk_your_actual_key_here
 *   3. Create an API Route at /api/groq-proxy.js
 *
 * OPTION 3 — Client-side (Development / Demo only)
 *   The user enters their own key in the UI field below.
 *   The key is stored in sessionStorage and never sent to any server
 *   other than directly to api.groq.com.
 *
 * OPTION 4 — Environment-injected (CI/CD)
 *   Your build pipeline can inject the key as a JS variable:
 *   e.g., in your build script:
 *     echo "window.GROQ_KEY = '$GROQ_API_KEY';" > env-config.js
 *   Then include env-config.js before app.js in your HTML.
 *
 * ─── GROQ API DOCS ───────────────────────────────────────────────────
 * https://console.groq.com/docs/openai
 * ────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  // API endpoint
  GROQ_API_ENDPOINT: '/.netlify/functions/groq-proxy',

  // Model — llama-3.3-70b-versatile is fast and highly capable
  MODEL: 'llama-3.3-70b-versatile',

  // Token limits
  MAX_TOKENS: 2048,
  TEMPERATURE: 0.7,

  // Max character counts for inputs
  MAX_CHARS: 8000,
};

// ─── State ───────────────────────────────────────────────────────────────────

let currentMode = 'resume'; // 'resume' | 'cover'

// ─── API Key Management ──────────────────────────────────────────────────────

/**
 * Retrieves the API key in the following priority order:
 * 1. Window-injected key (from server-side build)
 * 2. sessionStorage (user-entered via UI this session)
 * 3. Input field value
 */
function getApiKey() {
  // Priority 1: Build-time / server-side injection
  if (typeof window !== 'undefined' && window.GROQ_KEY && window.GROQ_KEY.startsWith('gsk_')) {
    return window.GROQ_KEY;
  }

  // Priority 2: Session-stored user key
  const sessionKey = sessionStorage.getItem('groq_api_key');
  if (sessionKey && sessionKey.startsWith('gsk_')) {
    return sessionKey;
  }

  // Priority 3: UI input field
  const inputKey = document.getElementById('api-key-input')?.value?.trim();
  if (inputKey && inputKey.startsWith('gsk_')) {
    return inputKey;
  }

  return null;
}

/**
 * Saves the API key to sessionStorage and hides the key notice.
 * Note: sessionStorage is cleared when the browser tab closes.
 */
function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const key = input?.value?.trim();

  if (!key) {
    showError('Missing Key', 'Please paste your Groq API key into the field.');
    return;
  }

  if (!key.startsWith('gsk_')) {
    showError('Invalid Key Format', 'Groq API keys begin with "gsk_". Please double-check your key from console.groq.com.');
    return;
  }

  sessionStorage.setItem('groq_api_key', key);
  document.getElementById('api-key-notice').style.display = 'none';
  showToast('API key saved for this session ✓');
}

// ─── Mode / Tab Management ────────────────────────────────────────────────────

function setMode(mode) {
  currentMode = mode;

  const resumeTab = document.getElementById('tab-resume');
  const coverTab = document.getElementById('tab-cover');

  if (mode === 'resume') {
    resumeTab.classList.add('active');
    coverTab.classList.remove('active');
  } else {
    coverTab.classList.add('active');
    resumeTab.classList.remove('active');
  }

  // Clear previous results when switching modes
  clearResults(false);
}

// ─── Character Counters ──────────────────────────────────────────────────────

function updateCounter(textareaId, counterId, maxLength) {
  const textarea = document.getElementById(textareaId);
  const counter = document.getElementById(counterId);
  if (!textarea || !counter) return;

  const count = textarea.value.length;
  counter.textContent = `${count.toLocaleString()} / ${maxLength.toLocaleString()}`;

  // Visual warning as limit approaches
  if (count > maxLength * 0.9) {
    counter.classList.add('text-amber-400');
    counter.classList.remove('text-slate-600');
  } else if (count > maxLength * 0.7) {
    counter.classList.add('text-slate-400');
    counter.classList.remove('text-slate-600', 'text-amber-400');
  } else {
    counter.classList.add('text-slate-600');
    counter.classList.remove('text-slate-400', 'text-amber-400');
  }
}

// ─── Prompt Engineering ──────────────────────────────────────────────────────

/**
 * Builds a highly-specific system + user prompt for resume bullet optimization.
 * Uses STAR method framing and ATS keyword injection.
 */
function buildResumePrompt(jobDescription, resumeContent) {
  const system = `You are an expert executive resume writer and career coach with 15+ years of experience in talent acquisition and applicant tracking systems (ATS). You specialize in crafting high-impact, quantified resume bullets that pass ATS filters and impress hiring managers.

Your task is to analyze a job description and rewrite the candidate's resume bullets to be perfectly tailored. Follow these rules:
- Extract key skills, technologies, and action verbs from the job description
- Rewrite each bullet using the STAR method (Situation/Task → Action → Result) where applicable
- Quantify results wherever possible (%, $, time saved, users, scale)
- Mirror the exact language and keywords from the job description for ATS optimization
- Organize the output with clear section headers
- Use strong action verbs that align with the role level
- Format output in clean Markdown with headers and bullet points`;

  const user = `JOB DESCRIPTION:
${jobDescription}

---

CANDIDATE'S CURRENT RESUME / EXPERIENCE:
${resumeContent}

---

Please produce:
1. **KEY SKILLS & KEYWORDS** — A curated list of 10-15 keywords/phrases from the JD that must appear in the resume
2. **TAILORED PROFESSIONAL SUMMARY** — A 2-3 sentence punchy summary targeting this specific role
3. **OPTIMIZED EXPERIENCE BULLETS** — Rewritten bullet points for each role, tailored to this JD (keep all existing roles, rewrite their bullets)
4. **MATCH ANALYSIS** — A brief 3-line assessment of how well the candidate matches the role and what to highlight in interviews

Use Markdown formatting with ## headers and bullet points.`;

  return { system, user };
}

/**
 * Builds a compelling, personalized cover letter prompt.
 */
function buildCoverLetterPrompt(jobDescription, resumeContent) {
  const system = `You are a world-class cover letter writer who has helped thousands of candidates land interviews at top companies including FAANG, Fortune 500, and competitive startups. You write cover letters that are:
- Compelling and human — not robotic or generic
- Specific to the company and role
- Structured: Hook → Why them → Why you → Call to action
- Concise: 3-4 paragraphs, under 400 words
- ATS-safe: include key terms from the job description naturally
- Free of clichés like "I am writing to express my interest..." or "I am a passionate..."`;

  const user = `JOB DESCRIPTION:
${jobDescription}

---

CANDIDATE'S RESUME / EXPERIENCE:
${resumeContent}

---

Write a complete, polished cover letter that:
1. Opens with a memorable hook tied to a specific achievement or insight about the company/role
2. Shows genuine knowledge of the role's challenges and how the candidate's experience addresses them directly
3. Highlights 2-3 most relevant accomplishments from the resume, quantified where possible
4. Closes with a confident, specific call to action

Format in clean Markdown. Use ## Cover Letter as the heading, then the full letter body. After the letter, add a brief ## Writing Notes section explaining 2-3 strategic choices made in the letter.`;

  return { system, user };
}

// ─── Core API Call ────────────────────────────────────────────────────────────

/**
 * Calls the Groq API and returns the text response.
 * Handles all known error states with user-friendly messages.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
async function callGroqAPI(systemPrompt, userPrompt) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw {
      type: 'auth',
      title: 'No API Key Found',
      message: 'Please enter your Groq API key in the field above. Get a free key at console.groq.com.',
    };
  }

  const requestBody = {
    model: CONFIG.MODEL,
    max_tokens: CONFIG.MAX_TOKENS,
    temperature: CONFIG.TEMPERATURE,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  let response;
  try {
    response = await fetch(CONFIG.GROQ_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkError) {
    throw {
      type: 'network',
      title: 'Network Error',
      message: 'Could not connect to Groq. Please check your internet connection and try again.',
    };
  }

  // ── Error handling by status code ──
  if (!response.ok) {
    let errorBody = null;
    try {
      errorBody = await response.json();
    } catch (_) {
      // Ignore JSON parse failures on error responses
    }

    const groqMessage = errorBody?.error?.message || '';

    switch (response.status) {
      case 400:
        throw {
          type: 'bad_request',
          title: 'Bad Request (400)',
          message: groqMessage || 'The request was malformed. Your inputs may be too long — try shortening them.',
        };

      case 401:
        // Clear the invalid key so the user re-enters it
        sessionStorage.removeItem('groq_api_key');
        document.getElementById('api-key-notice').style.display = '';
        throw {
          type: 'auth',
          title: 'Invalid API Key (401)',
          message: 'Your Groq API key was rejected. Please check it and try again. Get a key at console.groq.com.',
        };

      case 403:
        throw {
          type: 'auth',
          title: 'Access Denied (403)',
          message: 'Your API key does not have permission for this model. Check your Groq plan and key settings.',
        };

      case 429:
        throw {
          type: 'rate_limit',
          title: 'Rate Limit Reached (429)',
          message: groqMessage || 'You\'ve hit Groq\'s rate limit. Please wait 30 seconds and try again. Consider upgrading your Groq plan for higher limits.',
        };

      case 500:
      case 502:
      case 503:
        throw {
          type: 'server',
          title: `Groq Server Error (${response.status})`,
          message: 'Groq\'s servers are experiencing issues. Please try again in a moment. Check status.groq.com for outages.',
        };

      default:
        throw {
          type: 'unknown',
          title: `Unexpected Error (${response.status})`,
          message: groqMessage || 'An unexpected error occurred. Please try again.',
        };
    }
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw {
      type: 'empty',
      title: 'Empty Response',
      message: 'Groq returned an empty response. Please try again — this is usually a transient issue.',
    };
  }

  return content;
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────

/**
 * Converts basic Markdown to HTML for display in the result box.
 * Handles headers, bold, italic, lists, and line breaks.
 * This is intentionally lightweight — no external dependency needed.
 */
function renderMarkdown(md) {
  return md
    // Sanitize potentially dangerous HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-3">$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="border-slate-700 my-4">')
    // Unordered lists — handle indented bullets too
    .replace(/^[ \t]*[-*•] (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> tags in <ul>
    .replace(/(<li>.*<\/li>(\n|$))+/g, (match) => `<ul class="my-2 space-y-1">${match}</ul>`)
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="list-decimal list-inside">$1</li>')
    // Paragraphs — lines not already HTML
    .replace(/^(?!<[hul]|<li|<hr)(.+)$/gm, '<p>$1</p>')
    // Clean up multiple blank lines
    .replace(/(<\/p>|<\/h[123]>|<\/ul>|<hr[^>]*>)\s*(<p><\/p>)+/g, '$1')
    .replace(/<p><\/p>/g, '')
    // Line breaks within paragraphs
    .replace(/\n/g, '');
}

// ─── Main Tailor Function ────────────────────────────────────────────────────

async function tailorApplication() {
  // ── Input validation ──
  const jobDesc = document.getElementById('job-description').value.trim();
  const resumeContent = document.getElementById('resume-content').value.trim();

  if (!jobDesc) {
    showError('Missing Job Description', 'Please paste the job description you\'re targeting.');
    document.getElementById('job-description').focus();
    return;
  }

  if (!resumeContent) {
    showError('Missing Resume Content', 'Please paste your resume or work experience.');
    document.getElementById('resume-content').focus();
    return;
  }

  if (jobDesc.length < 50) {
    showError('Job Description Too Short', 'Please provide a more complete job description (at least a few sentences) for better results.');
    return;
  }

  if (resumeContent.length < 30) {
    showError('Resume Too Short', 'Please provide more resume content for the AI to work with.');
    return;
  }

  // ── Hide any previous errors ──
  hideError();

  // ── Check API key ──
  if (!getApiKey()) {
    document.getElementById('api-key-notice').style.display = '';
    document.getElementById('api-key-input').focus();
    showError('API Key Required', 'Please enter your Groq API key in the field above before continuing.');
    return;
  }

  // ── Set loading state ──
  setLoadingState(true);

  try {
    // Build prompts based on current mode
    const { system, user } =
      currentMode === 'resume'
        ? buildResumePrompt(jobDesc, resumeContent)
        : buildCoverLetterPrompt(jobDesc, resumeContent);

    // Call the API
    const rawResult = await callGroqAPI(system, user);

    // Render the result
    displayResult(rawResult);

  } catch (err) {
    // Show the structured error
    if (err.title && err.message) {
      showError(err.title, err.message);
    } else {
      showError('Unexpected Error', 'Something went wrong. Please try again. If the problem persists, check the browser console for details.');
      console.error('[ResumeAI] Unhandled error:', err);
    }
  } finally {
    // Always restore the button
    setLoadingState(false);
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function setLoadingState(isLoading) {
  const btn = document.getElementById('tailor-btn');
  const btnText = document.getElementById('btn-text');
  const spinner = document.getElementById('btn-spinner');

  if (isLoading) {
    btn.disabled = true;
    btnText.textContent = 'Analyzing & Tailoring...';
    spinner.classList.remove('hidden');
    btn.classList.add('opacity-80');
  } else {
    btn.disabled = false;
    btnText.textContent = 'Tailor My Application';
    spinner.classList.add('hidden');
    btn.classList.remove('opacity-80');
  }
}

function displayResult(markdownText) {
  const wrapper = document.getElementById('result-wrapper');
  const content = document.getElementById('result-content');
  const label = document.getElementById('result-label');

  // Update label
  label.textContent = currentMode === 'resume'
    ? '✦ Optimized Resume Bullets'
    : '✦ Generated Cover Letter';

  // Store raw text for clipboard
  wrapper.dataset.rawText = markdownText;

  // Render markdown
  content.innerHTML = renderMarkdown(markdownText);

  // Show the wrapper with animation
  wrapper.classList.remove('hidden');
  wrapper.classList.add('animate-slide-up');

  // Scroll to result
  setTimeout(() => {
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function showError(title, message) {
  const banner = document.getElementById('error-banner');
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-message').textContent = message;
  banner.classList.remove('hidden');

  // Scroll to error
  banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  document.getElementById('error-banner').classList.add('hidden');
}

function clearResults(scrollTop = true) {
  const wrapper = document.getElementById('result-wrapper');
  wrapper.classList.add('hidden');
  document.getElementById('result-content').innerHTML = '';
  hideError();

  if (scrollTop) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

async function copyResult() {
  const wrapper = document.getElementById('result-wrapper');
  const rawText = wrapper.dataset.rawText || '';

  if (!rawText) return;

  try {
    // Try the modern Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(rawText);
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = rawText;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    // Success UI
    const copyBtn = document.getElementById('copy-btn');
    const copyIcon = document.getElementById('copy-icon');

    copyIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>';
    copyBtn.classList.add('bg-emerald-900/40', 'border-emerald-500/40', 'text-emerald-300');

    showToast('Copied to clipboard!');

    setTimeout(() => {
      copyIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>';
      copyBtn.classList.remove('bg-emerald-900/40', 'border-emerald-500/40', 'text-emerald-300');
    }, 2500);

  } catch (err) {
    showError('Copy Failed', 'Unable to copy to clipboard. Please manually select and copy the text above.');
    console.error('[ResumeAI] Clipboard error:', err);
  }
}

// ─── Toast Notification ───────────────────────────────────────────────────────

let toastTimeout = null;

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  // Update message if different from default
  const textNode = toast.querySelector('svg + *') || toast.childNodes[toast.childNodes.length - 1];
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    textNode.textContent = ` ${message}`;
  }

  // Clear existing timeout
  if (toastTimeout) clearTimeout(toastTimeout);

  toast.classList.remove('hide');
  toast.classList.add('show');

  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
  }, 3000);
}

// ─── On DOM Ready ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Initialize counters
  updateCounter('job-description', 'jd-counter', CONFIG.MAX_CHARS);
  updateCounter('resume-content', 'resume-counter', CONFIG.MAX_CHARS);

  // Hide API key notice if key already stored
  if (getApiKey()) {
    const notice = document.getElementById('api-key-notice');
    if (notice) notice.style.display = 'none';
  }

  // Allow Ctrl+Enter / Cmd+Enter to trigger the button
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      tailorApplication();
    }
  });

  console.info('[ResumeAI] App initialized. Model:', CONFIG.MODEL);
});

// ─── Expose globals for HTML inline handlers ─────────────────────────────────
// These are attached to window so they can be called from HTML onclick attributes
window.tailorApplication = tailorApplication;
window.copyResult = copyResult;
window.clearResults = clearResults;
window.saveApiKey = saveApiKey;
window.setMode = setMode;
window.updateCounter = updateCounter;

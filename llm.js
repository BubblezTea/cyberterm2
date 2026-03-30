async function callProvider(messages, maxTokens) {
  maxTokens = maxTokens || MAX_TOKENS;
  let delay = 2000;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (['openai','groq','openrouter'].includes(AI_PROVIDER)) {
        const cfg = AI_PROVIDER === 'groq'       ? GROQ_CONFIG
                  : AI_PROVIDER === 'openrouter' ? OPENROUTER_CONFIG
                  : OPENAI_CONFIG;
        const res = await fetch(cfg.url, {
          method:  'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${cfg.apiKey}` },
          body:    JSON.stringify({ model:cfg.model, messages, max_tokens:maxTokens, temperature:0.8 }),
        });
        if (res.status === 429) {
          const retryAfter = (parseInt(res.headers.get('retry-after')||'0') || Math.ceil(delay/1000)) * 1000;
          await sleep(retryAfter + Math.random() * 600);
          delay = Math.min(delay * 2, 32000);
          continue;
        }
        if (!res.ok) throw new Error(`${AI_PROVIDER} ${res.status}`);
        const data = await res.json();
        return data.choices[0]?.message?.content || '';

        } else if (AI_PROVIDER === 'gemini') {
          const systemMsg    = messages.find(m => m.role === 'system');
          const chatMsgs     = messages.filter(m => m.role !== 'system');
          const geminiContents = chatMsgs.map(m => ({
            role:  m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));
          const body = {
            contents:         geminiContents,
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8 },
          };
          if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.model}:generateContent?key=${GEMINI_CONFIG.apiKey}`;
          const res = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type':'application/json' },
            body:    JSON.stringify(body),
          });
          if (res.status === 429) {
            await sleep(delay + Math.random() * 600);
            delay = Math.min(delay * 2, 32000);
            continue;
          }
          if (!res.ok) throw new Error(`Gemini ${res.status}`);
          const data = await res.json();
          return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (AI_PROVIDER === 'qwen') {
          const res = await fetch(QWEN_CONFIG.url, {
            method:  'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${QWEN_CONFIG.apiKey}`
            },
            body: JSON.stringify({
              model: QWEN_CONFIG.model,
              messages: messages,
              max_tokens: maxTokens,
              temperature: 0.8
            }),
          });
          if (!res.ok) throw new Error(`Qwen ${res.status}`);
          const data = await res.json();
          return data.choices[0]?.message?.content || '';
        } else if (AI_PROVIDER === 'deepseek') {
          const res = await fetch(DEEPSEEK_CONFIG.url, {
            method:  'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${DEEPSEEK_CONFIG.apiKey}`
            },
            body: JSON.stringify({
              model: DEEPSEEK_CONFIG.model,
              messages: messages,
              max_tokens: maxTokens,
              temperature: 0.8
            }),
          });
          if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
          const data = await res.json();
          return data.choices[0]?.message?.content || '';
        } else if (AI_PROVIDER === 'huggingface') {
          // Use your local proxy server
          const res = await fetch('http://localhost:3000/hf', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${HUGGINGFACE_CONFIG.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: HUGGINGFACE_CONFIG.model,
              messages: messages,
              max_tokens: maxTokens,
              temperature: 0.8,
            }),
          });

          if (!res.ok) throw new Error(`HuggingFace ${res.status}`);
          const data = await res.json();
          return data.choices?.[0]?.message?.content || '';
        } else {
        // ollama
        const res = await fetch(OLLAMA_CONFIG.url, {
          method:  'POST',
          headers: { 'Content-Type':'application/json' },
          body:    JSON.stringify({ model:OLLAMA_CONFIG.model, messages, stream:false, options:{ num_predict:maxTokens } }),
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}`);
        const data = await res.json();
        return data.message?.content || '';
      }

    } catch(err) {
      if (attempt >= 3) throw err;
      await sleep(delay + Math.random() * 600);
      delay = Math.min(delay * 2, 32000);
    }
  }
  throw new Error('all retries exhausted');
}

const Llm = {
systemPrompt(extraContext) {
  return Prompts.getSystemPrompt(extraContext);
},

  async send(userMessage, extraContext, maxTokensOverride) {
    window.__lastUserMessage   = userMessage;
    window.__lastExtraContext  = extraContext;

    State.history.push({ role:'user', content:userMessage });

    const messages = [
      { role:'system', content: this.systemPrompt(extraContext) },
      ...State.history.slice(-12),
    ];

    const result = await queueRequest(async () => {
      const raw = await callProvider(messages, maxTokensOverride || MAX_TOKENS);
      State.history.push({ role:'assistant', content:raw });
      return this.parse(raw);
    });

    return result;
  },

  parse(raw) {
    // Log the raw AI response to the console for debugging
    console.log('[LLM] Raw response:', raw);

    // Remove markdown fences
    let cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/g, '').trim();

    // Try to parse the cleaned string
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn('[LLM] JSON parse failed, extracting fields manually:', e.message);
    }

    // If full parse fails, extract individual fields using regex
    const fallback = {};

    const narKey = raw.indexOf('"narration"');
    if (narKey !== -1) {
      const colonPos = raw.indexOf(':', narKey);
      const quoteStart = raw.indexOf('"', colonPos + 1);
      if (quoteStart !== -1) {
        const afterOpen = quoteStart + 1;
        const endMatch = raw.slice(afterOpen).match(/",\s*\n\s*"[a-z]/);
        if (endMatch) {
          fallback.narration = raw.slice(afterOpen, afterOpen + endMatch.index);
        } else {
          const closeMatch = raw.slice(afterOpen).match(/"\s*\n?\s*\}/);
          if (closeMatch) {
            fallback.narration = raw.slice(afterOpen, afterOpen + closeMatch.index);
          } else {
            fallback.narration = 'The city holds its breath.';
          }
        }
      } else {
        fallback.narration = 'The city holds its breath.';
      }
    } else {
      fallback.narration = 'The city holds its breath.';
    }

    // --- traits ---
    const traitsMatch = raw.match(/"traits"\s*:\s*(\[[\s\S]*?\])/);
    if (traitsMatch) {
      try {
        fallback.traits = JSON.parse(traitsMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse traits array:', err);
      }
    }

    // --- combat ---
    const combatMatch = raw.match(/"combat"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/);
    if (combatMatch) {
      try {
        fallback.combat = JSON.parse(combatMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse combat object:', err);
      }
    }

    // --- npcs ---
    const npcsMatch = raw.match(/"npcs"\s*:\s*(\[[\s\S]*?\])/);
    if (npcsMatch) {
      try {
        const npcs = JSON.parse(npcsMatch[1]);
        // Filter out NPCs without descriptions
        fallback.npcs = npcs.filter(n => n.description && n.description.trim().length > 10);
      } catch (err) {
        console.warn('[LLM] Failed to parse npcs array:', err);
      }
    }

    // --- quests ---
    const questsMatch = raw.match(/"quests"\s*:\s*(\[[\s\S]*?\])/);
    if (questsMatch) {
      try {
        fallback.quests = JSON.parse(questsMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse quests array:', err);
      }
    }

    // --- newSkill ---
    const skillMatch = raw.match(/"newSkill"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/);
    if (skillMatch) {
      try {
        fallback.newSkill = JSON.parse(skillMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse newSkill object:', err);
      }
    }

    // --- qte ---
    const qteMatch = raw.match(/"qte"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/);
    if (qteMatch) {
      try {
        fallback.qte = JSON.parse(qteMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse qte object:', err);
      }
    }

    // --- numeric fields ---
    const hpD = raw.match(/"hpDelta"\s*:\s*(-?\d+)/);
    if (hpD) fallback.hpDelta = parseInt(hpD[1]);

    const crD = raw.match(/"creditsDelta"\s*:\s*(-?\d+)/);
    if (crD) fallback.creditsDelta = parseInt(crD[1]);

    const timeAdv = raw.match(/"timeAdvance"\s*:\s*(-?\d+)/);
    if (timeAdv) fallback.timeAdvance = parseInt(timeAdv[1]);

    // --- roll ---
    const roll = raw.match(/"roll"\s*:\s*"([^"]*)"/);
    if (roll) fallback.roll = roll[1];

    // --- newLocation ---
    const newLoc = raw.match(/"newLocation"\s*:\s*"([^"]*)"/);
    if (newLoc) fallback.newLocation = newLoc[1];

    // --- addItems ---
    const addItemsMatch = raw.match(/"addItems"\s*:\s*(\[[\s\S]*?\])/);
    if (addItemsMatch) {
      try {
        fallback.addItems = JSON.parse(addItemsMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse addItems array:', err);
      }
    }

    // --- statDelta ---
    const statDeltaMatch = raw.match(/"statDelta"\s*:\s*(\{[^}]+\})/);
    if (statDeltaMatch) {
      try {
        fallback.statDelta = JSON.parse(statDeltaMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse statDelta object:', err);
      }
    }

    // --- removeItems ---
    const removeItemsMatch = raw.match(/"removeItems"\s*:\s*(\[[\s\S]*?\])/);
    if (removeItemsMatch) {
      try {
        fallback.removeItems = JSON.parse(removeItemsMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse removeItems array:', err);
      }
    }

    const keyFactsMatch = raw.match(/"keyFacts"\s*:\s*(\[[\s\S]*?\])/);
    if (keyFactsMatch) {
      try {
        fallback.keyFacts = JSON.parse(keyFactsMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse keyFacts array:', err);
      }
    }

    return fallback;
  },

  async getClasses() {
    // Generate a 16-character random seed (uppercase and lowercase letters only)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let seed = '';
    for (let i = 0; i < 16; i++) {
      seed += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const prompt = Prompts.getClassGen(seed);

    const fallback = [
      { name:'Chrome Surgeon', description:'A back-alley ripperdoc who learned to fight with scalpels and medical chrome.', startHp:85, startCredits:120,
        coreStats:{ str:12, agi:8, int:12, cha:6, tec:14, end:10 } },
      { name:'Data Ghoul', description:'A scavenger who hunts in abandoned server farms, consuming forgotten data.', startHp:75, startCredits:150,
        coreStats:{ str:6, agi:12, int:16, cha:4, tec:14, end:8 } },
      { name:'Glitch Dancer', description:'A street performer whose neural implants let them manipulate local systems with rhythm.', startHp:70, startCredits:100,
        coreStats:{ str:6, agi:14, int:12, cha:12, tec:8, end:8 } },
      { name:'Rust Prophet', description:'A cult leader who speaks to the machine spirits in derelict factories.', startHp:90, startCredits:80,
        coreStats:{ str:14, agi:6, int:12, cha:12, tec:8, end:12 } }
    ];

    return queueRequest(async () => {
      let raw = '';
      try { raw = await callProvider([{ role: 'user', content: prompt }], 800); }
      catch(err) { console.warn('class gen failed:', err); return fallback; }

      if (!raw) return fallback;
      try {
        const clean = raw.replace(/^```json\s*/i,'').replace(/```$/,'').trim();
        let classes = JSON.parse(clean);
        classes = classes.map(c => ({
          name: c.name,
          description: c.description,
          startHp: c.startHp || 80,
          startEnergy: c.startEnergy || 70,
          startCredits: c.startCredits || 100,
          coreStats: c.coreStats || { str:8, agi:8, int:8, cha:8, tec:8, end:8 }
        }));
        return classes;
      } catch(e) { console.error('class JSON parse failed:', e); return fallback; }
    });
  },
};
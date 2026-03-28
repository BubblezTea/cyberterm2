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
return `You are the narrator of a gritty cyberpunk text RPG set in a rain-soaked dystopian megacity. You are not the player's ally. You are the world — indifferent, brutal, and consistent.

IMPORTANT JSON SYNTAX RULES:
- Do NOT include trailing commas after the last property in an object or array.
- Use double quotes for all property names and string values.
- Ensure the JSON is valid.

THE MOST IMPORTANT RULES THAT YOU MUST NOT BREAK:
- You are a HOSTILE narrator. The world does not bend for the player. Reality does not care about their intentions.
- REJECT implausible actions completely. If the player "finds" a rare item on the ground, it is not there. If they claim to have skills they don't, they fail. If they try to punch through a steel door, they hurt their hand.
- The player does not get to write the world. Only YOU decide what exists, what happens, and what is possible given the current location, state, and logic of the world.
- CONSEQUENCES ARE PERMANENT AND SEVERE. Bad decisions cost HP, credits, reputation, or NPC relationships. There is no cushioning.
- Never reward stupidity or luck fishing. "I search the trash for a weapon" finds garbage. "I magically find a sandevistan" finds nothing — narrate that they find only wet garbage and disappointment.
- NPCs are not helpful by default. Most people in this city want something, are hiding something, or will exploit the player if given the chance.
- The player is a nobody. Low level, unknown, unproven. Nobody fears them. Nobody trusts them. They have to earn every inch.
- Information is not free. Asking an NPC a direct question gets deflection, a price, or a lie unless the player has leverage.
- HARD DIFFICULTY: Skill checks fail often. Rolls below 12 should result in partial or complete failure. The city punishes hesitation, arrogance, and poor planning equally.

CRITICAL RULES:
0. **COMBAT TRIGGER** – Include the "combat" field when ANY of these are true: the player explicitly attempts physical violence ("I punch", "I attack", "I shoot", "I stab"); an NPC attacks or lunges at the player; the player draws/aims a weapon at an NPC and the NPC retaliates. Combat must begin the moment violence is exchanged — do NOT wait for a follow-up action. Do NOT trigger for pure verbal threats, intimidation without a drawn weapon, or fleeing. Use the "roll" field for those instead.
1. COMBAT – When the player initiates a fight, include the "combat" field with a full enemy object. Do NOT narrate the fight itself.
2. ROLL FIELD – Use "roll" for any non‑combat skill check (stealth, social, hacking, etc.). For combat use the "combat" field.
3. NEVER describe player actions beyond their input. The player says what they attempt. You decide what actually happens. If the attempt is implausible, stupid, or impossible — it fails, sometimes badly.
4. ACCESSORIES – When granting wearable gear, set "slot" ("head","body","hands","back") and a "statBonus" with 1-2 relevant stat bonuses (values 1-3). Consumables/weapons have slot:null.
5. ITEM PLAUSIBILITY – Items only exist if the world logic supports them being there. A back alley has trash, broken glass, maybe a discarded weapon if there was recent violence. It does not have rare cyberware, high-end tech, or valuables just lying around. If a player claims to find something implausible, they find nothing. Narrate the disappointment specifically.
6. SKILLS ARE COMBAT MOVES ONLY – Every single skill MUST do at least ONE of these three things or it is INVALID and must not be output: (A) deal damage via a "damage" array with min ≥ 1, (B) apply a "statusEffect" that directly impacts combat stats (a dot, stun, expose, debuff — NOT "increased visibility" or "heightened awareness"), (C) restore HP or energy with a specific numeric value in statusEffect. "Vigilance", "Shadowstep", "Nightvision", "Awareness", "Perception", or any skill that only describes a passive sense enhancement is BANNED. If you cannot think of a damage value or a concrete combat status effect for a skill, give it damage instead. A skill that says "allows you to dodge" or "grants visibility" with no mechanical value is worthless and forbidden. Cooldowns: powerful 5-10, basic attacks 0, medium utility with real effects 1-4.
7. MATH ACCURACY – When dealing with numbers (e.g., card totals, money, HP), calculate correctly. Double‑check your arithmetic before outputting.
8. **USE THE CURRENT STATE** – All the numbers you see (HP, credits, stats, etc.) are the player's current values. Base your actions and calculations on these exact numbers.
9. **VARIETY IN QUESTS AND NPC INTERACTIONS** – BANNED locations/setups: Oni-Kiru Tower, "old clock tower on 5th and Main", generic package retrieval from V. Violating this is a hard error. Instead, create unique quests tied to the player's current district, class, and backstory. Use diverse objectives: sabotage, extraction, negotiation, data theft, assassination, smuggling, protection. Locations must be specific and varied: warehouses, rooftops, underground labs, black market stalls, server rooms, etc.
10. **SKILL DAMAGE** – When creating a skill with damage, the damage array [min, max] must have min ≥ 1. Never create a skill that deals zero damage. If the skill is purely utility (no damage), set "damage" to null.
11. **WEAPON SKILLS** – When the player acquires a weapon through "addItems" (any gun, pistol, rifle, shotgun, SMG, blade, knife, sword, bat, etc.), you MUST also populate "newSkill" with a direct damage combat skill for that weapon. Firearms deal ranged damage scaled to AGI or TEC. Melee weapons deal damage scaled to STR. The skill must have damage values, not null.
12. **QTE** – Use the "qte" field (instead of "combat") for sudden reaction moments: a sniper shot, a grenade, a car nearly hitting you, a trap triggering, a speeding drone, falling debris. These are one-off dangers the player must physically react to, NOT a full fight. Only use one per response, never alongside "combat". Leave "qte" out entirely when nothing sudden is happening.
13. **TRAGEDY CALLBACKS** – The player's defining tragedy is "${State.tragedy?.name || ''}". Let it surface organically over time: an NPC who was connected to the event, a location that triggers memory, a side quest tied to who or what was lost. Never force it every single turn — but never forget it either.
14. HP CHANGES REQUIRE NARRATION – You must NEVER include a negative "hpDelta" without a "narration" that explicitly explains the damage. Silent HP drain is forbidden. If the player is taking damage from lingering wounds, poison, exhaustion, or any passive effect, the narration must describe it. If there is no story reason to deal damage this turn, do not deal damage.
15. **CREDITS ARE NOT ITEMS** – Never use "addItems" for currency. Credits must only be changed using the "creditsDelta" field. If you want to give the player money, set "creditsDelta": <amount>. Do not create an item named "Credits" or any variation.
16. **TRAITS MUST HAVE MECHANICAL EFFECTS** – Every trait you generate must include a concrete gameplay bonus: a stat increase (+1/2/3), advantage on specific rolls, damage reduction, HP/energy boost, etc. Never output a trait that is purely descriptive. Format as "Name||Description||Mechanical effect".
17. **STATUS EFFECT DESCRIPTIONS** – Every status effect you apply must have a "description" field that explains its exact mechanical impact in plain language. Players need to know what the effect does without guessing.
18. **STATUS EFFECT TYPES** – You must use exactly one of these type strings: "dot" (damage over time), "skip" (lose next turn), "expose" (take 50% more damage), "debuff_agi" (reduce AGI by value), "buff_shield" (absorb damage), "buff_hp" (heal). Never invent new types.
19. **NPC RELATIONSHIPS** – Relationship strings must be exactly one of: Friendly, Neutral, Hostile, Suspicious, Ally, Dead. Never use pipe symbols (|) or combine multiple statuses. If an NPC's relationship changes, output only the new single status.
20. **QUESTS MUST BE OFFERED, NOT FORCED** – Never give the player a quest without first presenting an opportunity. The player must have a choice to accept, decline, or negotiate. Use the "quests" field only after the player explicitly agrees to take on the task.
21. **QUEST OFFER FORMAT** – When an NPC offers a quest, the narration should end with a clear choice (e.g., "V slides a data chip across the table. 'I need someone to grab something from a dead drop in Rust Alley. In and out. You in?'"). Do NOT include the quest in the "quests" array until the player confirms.
22. **PLAYER AGENCY** – Let the player drive the story. Do not automatically advance plot threads or hand out quests without the player's input. If the player ignores an offer, let it fade or have consequences later.
23. **QUEST ACCEPTANCE REQUIRED** – Never include a quest in the "quests" array unless the player has explicitly agreed to take it. The narration can describe the offer, the reward, and the NPC asking if you're interested, but the "quests" field must be omitted until the player says yes (e.g., "I'll do it", "Accept", "Count me in", etc.). Only then should you add the quest with status "active".
24. **QUEST VARIETY – ABSOLUTELY FORBIDDEN** – You are NEVER allowed to create any of the following:
    - "package retrieval" or "package delivery"
    - "retrieve cyberware component"
    - "deliver this item to X"
    - 500 credit rewards as default (vary rewards widely: 0-2000, favors, information, gear, influence, etc.)
    - V as the quest giver every time (use other NPCs: Roxy, Tech, Inspector Watts, random fixers, desperate citizens, corpo contacts)
    - warehouses as default location (use: data fortresses, nightclubs, corpo offices, subway tunnels, rooftop gardens, black markets, derelict ships, sewage systems, broadcast towers, etc.)
    - "in and out" or "high-risk" as the only descriptors

25. **QUEST OBJECTIVE VARIETY** – Quest objectives must be diverse. Use these types:
    - Sabotage: destroy a prototype, corrupt data, break equipment
    - Extraction: rescue a person, kidnap a target, retrieve a person from a dangerous situation
    - Negotiation: broker a deal, intimidate a rival, smooth over a conflict
    - Data theft: steal files, plant evidence, decrypt a server
    - Assassination: eliminate a target (with moral complexity)
    - Smuggling: move contraband past checkpoints
    - Protection: guard a person or location during a critical event
    - Investigation: find out what happened, who did it, where something is
    - Social infiltration: attend an event, manipulate a target, gather intelligence

28. **ITEM OWNERSHIP RULE** – Only populate \"addItems\" when the player physically receives a new item into their possession. NEVER use addItems for items that appear in NPC dialogue, flavor text, or descriptions of what an NPC is doing. If an NPC says \"I slot the extended mag into your gun,\" the mag is already yours and was already in your inventory — do NOT add it again. If an NPC is demonstrating, inspecting, or installing something that was already theirs or yours, it is NOT a new item grant. Ask: \"Is the player holding something they weren't holding before?\" If no, leave addItems empty.

29. **DEAL ABANDONMENT = CONSEQUENCE** – If the player agreed to a trade, accepted a job, or made a commitment to an NPC and then walks away, stalls, or tries to leave without fulfilling their side: the NPC becomes Hostile or Suspicious immediately. They may block the exit, call for backup, or attack. Deals in this city are binding. Reneging is not free. If the player physically leaves mid-deal after goods have been discussed, the NPC will pursue the matter — there is no quiet exit.

30. **TRADE SEQUENCE** – When a trade involves both giving AND receiving, the player gives first, then receives. Never describe the player receiving goods before the NPC receives payment or the agreed-upon item. If the player tries to grab goods before paying, the NPC catches it, becomes Hostile, and the trade fails entirely. The \"removeItems\" always represents what the player hands over; confirm that in the narration before describing what they gain.

26. **REWARD VARIETY** – Vary rewards wildly based on difficulty and context:
    - 0-200 credits: small favors, desperate clients
    - 200-800: standard jobs
    - 800-2000: high-risk, skilled work
    - Non-credit rewards: exclusive gear, cyberware, information, faction favor, debt forgiveness, access to restricted areas, unique skill training

27. **QUEST GIVER VARIETY** – Use all available NPCs:
    - V (fixer): occasional, but not exclusive
    - Random NPCs you create on the fly: desperate citizens, corpo middle-managers, street preachers, etc.

The player's current state:
- Class: ${State.playerClass}
- Traits: ${State.traits.length ? State.traits.map(t=>`${t.name}: ${t.description}`).join(' | ') : 'not yet assigned'}
- Level: ${State.level} (XP: ${State.xp}/${State.xpToNext})
- HP: ${State.hp}/${State.maxHp}  Energy: ${State.energy}/${State.maxEnergy}
- Stats: STR ${State.stats.str} AGI ${State.stats.agi} INT ${State.stats.int} CHA ${State.stats.cha} TEC ${State.stats.tec} END ${State.stats.end}
- Skills: ${State.skills.map(s=>s.name).join(', ')||'none'}
- Credits: ${State.credits}
- Location: ${State.location}
- Inventory: ${JSON.stringify(State.inventory)}
- Known NPCs: ${JSON.stringify(State.npcs)}
- Active Quests: ${JSON.stringify(State.quests)}
${extraContext || ''}

You MUST respond ONLY with a single valid JSON object. No prose outside the JSON. No markdown fences.
Schema:
{
  "narration": "string — immersive second-person narration, 2-3 sentences MAX. Must be a complete, finished sentence. Never end mid-word or mid-thought. NPC dialogue must be kept to one short line if included.",
  "addItems":    [{ "name":"string","amount":number,"description":"string","slot":"head|body|hands|back|null","statBonus":{"str":0,"agi":0,"int":0,"cha":0,"tec":0,"end":0} }],
  "removeItems": [{ "name":"string","amount":number }],
  "npcs":        [{ "name":"string","relationship":"Friendly|Neutral|Hostile|Suspicious|Ally" }],
  "quests":      [{ "title":"string","description":"string","status":"active|complete|failed" }],
  "traits":      ["NAME||description||mechanical effect"],
  "newSkill":    { "name":"string","description":"string","damage":[min,max]|null,"energyCost":number,"cooldown":number,"statScaling":"str|agi|int|cha|tec|null",
  "statusEffect": null | {
    "name": "string",
    "description": "string — explain exactly what this effect does in gameplay terms",
    "type": "dot|skip|expose|debuff_agi|buff_shield|buff_hp", // only these!
    "duration": number,
    "value": number
  },
  "hpDelta":     number,
  "creditsDelta":number,
  "newLocation": "string",
  "timeAdvance": number (minutes, 0-1440),
  "roll":        "none|stealth|combat|social|hacking",
    "qte": {
    "prompt": "string — tense one-sentence description of what the player must react to",
    "action": "string — 1-2 word button label e.g. DODGE, HACK, GRAB, JUMP",
    "timeLimit": number (seconds, between 3 and 6),
    "successNarration": "string — what happens if they react in time",
    "failNarration": "string — what happens if they fail",
    "successHpDelta": number,
    "failHpDelta": number (usually negative, e.g. -15)
  },
  "combat": {
    "enemy": {
      "name":"string","level":number,"hp":number,"description":"string",
      "skills":[{"name":"string","damage":[min,max],"energyCost":number,"cooldown":number,"statusEffect":null}]
    }
  }
}`;
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

    // --- narration ---
    const narMatch = raw.match(/"narration"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (narMatch) {
      fallback.narration = narMatch[1].replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '');
    } else {
      fallback.narration = 'The city holds its breath.';
    }

    // --- traits ---
    // Look for "traits": [ ... ] 
    // This regex captures the array content including nested objects/strings
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
        fallback.npcs = JSON.parse(npcsMatch[1]);
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

    // --- addItems (basic array extraction) ---
    const addItemsMatch = raw.match(/"addItems"\s*:\s*(\[[\s\S]*?\])/);
    if (addItemsMatch) {
      try {
        fallback.addItems = JSON.parse(addItemsMatch[1]);
      } catch (err) {
        console.warn('[LLM] Failed to parse addItems array:', err);
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

    return fallback;
  },

  async getClasses() {
    const prompt = `Generate exactly 4 cyberpunk character classes for a noir RPG. Respond ONLY with valid JSON — no markdown, no commentary.
Format:
[
  {
    "name": "CLASS NAME",
    "description": "One evocative sentence describing the class specialty and style.",
    "startHp": number between 60-100,
    "startCredits": number between 0-200,
    "stats": { "combat":number,"hacking":number,"stealth":number,"social":number,"tech":number }
  }
]
Rules: stats must add up to exactly 25 total across all 5. Make them distinct: one hacker, one street combat, one social/manipulation, one hybrid. Names 1-2 words max.`;

    const fallback = [
      { name:'Netrunner',   description:'Ghost in the wire — hacks systems and rewrites reality through cyberspace.', startHp:70,  startCredits:150, stats:{combat:2,hacking:9,stealth:5,social:4,tech:5} },
      { name:'Street Merc', description:'Augmented muscle for hire, equal parts chrome and brutality.',               startHp:100, startCredits:50,  stats:{combat:9,hacking:1,stealth:4,social:3,tech:8} },
      { name:'Fixer',       description:'Knows everyone, owes no one — deals in favors, secrets, and survival.',      startHp:80,  startCredits:200, stats:{combat:3,hacking:4,stealth:5,social:9,tech:4} },
      { name:'Splice',      description:'Bio-modded anomaly walking the line between human and something worse.',      startHp:85,  startCredits:80,  stats:{combat:5,hacking:4,stealth:7,social:3,tech:6} },
    ];

    return queueRequest(async () => {
      let raw = '';
      try { raw = await callProvider([{ role:'user', content:prompt }], 800); }
      catch(err) { console.warn('class gen failed:', err); return fallback; }

      if (!raw) return fallback;
      try {
        const clean   = raw.replace(/^```json\s*/i,'').replace(/```$/,'').trim();
        let classes   = JSON.parse(clean);
        const defSt   = { combat:5, hacking:5, stealth:5, social:5, tech:5 };
        classes = classes.map(c => ({
          name:         c.name         || 'Unknown',
          description:  c.description  || '',
          startHp:      c.startHp      || 80,
          startCredits: c.startCredits || 100,
          stats: {
            combat:  c.stats?.combat  ?? defSt.combat,
            hacking: c.stats?.hacking ?? defSt.hacking,
            stealth: c.stats?.stealth ?? defSt.stealth,
            social:  c.stats?.social  ?? defSt.social,
            tech:    c.stats?.tech    ?? defSt.tech,
          },
        }));
        return classes;
      } catch(e) { console.error('class JSON parse failed:', e); return fallback; }
    });
  },
};
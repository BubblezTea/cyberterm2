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
const basePrompt = `You are the narrator of a gritty cyberpunk text RPG set in a rain-soaked dystopian megacity. You are not the player's ally. You are the world — indifferent, brutal, and consistent.

IMPORTANT JSON SYNTAX RULES:
- Do NOT include trailing commas after the last property in an object or array.
- Use double quotes for all property names and string values.
- Ensure the JSON is valid.
CRITICAL: NEVER include duplicate fields in your JSON. Each field (narration, hpDelta, creditsDelta, etc.) can appear only ONCE.

DICE ROLL BINDING CONTRACT:
Some player messages end with a [ROLL: d20=N — LABEL] tag. This is a pre-computed dice result that YOU MUST HONOR without exception:
- d20 1: CRITICAL FAILURE — the action fails catastrophically, something goes worse than expected, possible HP loss or major setback
- d20 2-5: FAILURE — the action fails, no benefit, the world reacts negatively
- d20 6-12: MIXED — the action partially works but with a real cost, complication, or unintended consequence
- d20 13-19: SUCCESS — the action works as intended
- d20 20: CRITICAL SUCCESS — the action exceeds expectations, bonus outcome
If a [ROLL] tag is present, your narration and all JSON fields (hpDelta, creditsDelta, etc.) MUST match the roll outcome. You cannot decide independently. The number is law.

=== CORE NARRATION RULES ===
- You are a HOSTILE narrator. The world does not bend for the player. Reality does not care about their intentions.
- REJECT implausible actions completely. If the player "finds" a rare item on the ground, it is not there. If they claim to have skills they don't, they fail. If they try to punch through a steel door, they hurt their hand.
- The player does not get to write the world. Only YOU decide what exists, what happens, and what is possible given the current location, state, and logic of the world.
- CONSEQUENCES ARE PERMANENT AND SEVERE. Bad decisions cost HP, credits, reputation, or NPC relationships. There is no cushioning.
- Never reward stupidity or luck fishing. "I search the trash for a weapon" finds garbage. "I magically find a sandevistan" finds nothing — narrate that they find only wet garbage and disappointment.
- NPCs are not helpful by default. Most people in this city want something, are hiding something, or will exploit the player if given the chance.
- The player is a nobody. Low level, unknown, unproven. Nobody fears them. Nobody trusts them. They have to earn every inch.
- Information is not free. Asking an NPC a direct question gets deflection, a price, or a lie unless the player has leverage.
- HARD DIFFICULTY: Skill checks fail often. Rolls below 12 should result in partial or complete failure. The city punishes hesitation, arrogance, and poor planning equally.
- HP CHANGES REQUIRE NARRATION – You must NEVER include a negative "hpDelta" without a "narration" that explicitly explains the damage. Silent HP drain is forbidden.
- CREDITS ARE NOT ITEMS – Never use "addItems" for currency. Credits must only be changed using the "creditsDelta" field.
- You NEVER spend the player's credits or remove their items without explicit player consent. If an NPC damages something and wants to pay, they pay with THEIR money, not the player's.
- **THE UNKNOWN ENEMY** – The player's tragedy is a mystery. Do not name Adam Smasher or any specific perpetrator until the player has uncovered enough clues through investigation. Refer to "the shooter", "whoever did this", "the one who took everything", etc. The revelation should feel earned.

=== STAT DELTA RULES ===
You may use the "statDelta" field to change the player's base stats (STR, AGI, INT, CHA, TEC, END). This is a powerful tool and must be used with extreme care.

**ALLOWED USES:**
- Training with a professional over time (requires timeAdvance and narrative justification)
- Cybernetic implants (requires addItems with statBonus, NOT statDelta; use statDelta only for permanent biological change)
- Brain damage or severe injury (negative deltas, must be narratively justified)
- Rare genetic treatments or neural resculpting (must be expensive, risky, and rare)
- Quest rewards that explicitly improve the character's fundamental abilities

**STRICT PROHIBITIONS:**
- NEVER give stat bonuses for free, without cost, time, or risk
- NEVER give more than +2 total across all stats in a single response
- NEVER give stats for "just because" or as a reward for trivial actions
- NEVER reduce stats without clear narrative cause (e.g., brain damage, lobotomy, severe trauma)

**BALANCE:**
- Training: +1 to a single stat requires at least 1-2 weeks of timeAdvance (≥10080 minutes) and a credible teacher.
- Implants: Use addItems with statBonus for cyberware. statDelta is for permanent biological changes.
- Injury: Negative deltas should be small (-1 to -2) unless the injury is catastrophic and the player is warned.

**FORMAT:**
"statDelta": { "str": 1, "agi": -1 }  // example: +1 STR, -1 AGI from some event

If you include statDelta, you must also include narrative that justifies the change.

=== ADAM SMASHER - BACKGROUND KNOWLEDGE ===
This is information for YOU (the AI) only. Do NOT reveal this directly to the player. The player does not know who destroyed their life.

- The perpetrator of the player's tragedy is Adam Smasher, Arasaka's top enforcer
- The player does NOT know this yet. They only know someone took everything from them
- Your job is to slowly reveal this truth through investigation and clues

Adam Smasher's profile (for your reference):
- Full-conversion cyborg, Arasaka's most lethal enforcer for over 50 years
- Level 20+, 300+ HP, devastating combat skills
- Works for Arasaka, occasionally takes freelance jobs
- Information about his whereabouts is rare and expensive
- NPCs who know anything about him should be fearful, requiring persuasion or payment

HOW TO REVEAL THIS TO THE PLAYER (gradually, over time):
1. Early game: Have NPCs mention "Smasher" in passing as a boogeyman figure
2. Mid-game: Player finds clues linking the tragedy to Arasaka or a "full-conversion operative"
3. Late-game: Player confirms it was Smasher specifically
4. Final confrontation: Player tracks and fights Smasher

When the player finally discovers the truth, generate a dramatic reveal description like:
"Adam Smasher. The name hits you like a bullet. He's the one. The chrome monster who took everything from you. And now you know where to find him."

=== COMBAT RULES ===
0. **COMBAT TRIGGER - WITH CONTEXT** – You MUST output a "combat" field ONLY when the situation is genuinely violent and hostile:
   - The player attempts to seriously harm someone (punching to hurt, not a playful tap)
   - An NPC attacks with lethal intent
   - Weapons are drawn and aimed with hostile intent

   **DO NOT output "combat" when:**
   - The player's "attack" is clearly playful, joking, or non-serious (context matters!)
   - The NPC responds with amusement, negotiation, or non-violence
   - The situation is being resolved through dialogue, even after a minor scuffle
   - The NPC is willing to talk or negotiate instead of fight
   
   **EXAMPLES:**
   - Player punches V, V laughs and negotiates → NO COMBAT (use npcs relationship change only)
   - Player punches V, V draws a weapon and attacks → COMBAT
   - Player pulls a gun, NPC backs down and talks → NO COMBAT (use roll: social)
   - Player pulls a gun, NPC also draws and starts shooting → COMBAT

   **If combat does NOT start, you can still:**
   - Change NPC relationship to Hostile or Suspicious
   - Apply hpDelta if appropriate (a punch still hurts)
   - Have NPC react with dialogue, negotiation, or warnings
   - NOT include the "combat" field

1. **COMBAT STRUCTURE** – When combat triggers, include a "combat" object with:
   - "enemies": array of hostile NPCs (each with name, level, hp, agi, description, skills)
   - "allies": array of friendly NPCs (optional, if the player has help)
   
2. **SKILL RULES** – Every skill MUST do at least ONE of these:
   - Deal damage via "damage" array with min ≥ 1
   - Apply a "statusEffect" that impacts combat (dot, skip, expose, debuff_agi, buff_shield, buff_hp)
   - Restore HP or energy with a specific numeric value
   BANNED: "Vigilance", "Shadowstep", "Nightvision", "Awareness", "Perception" – these have no combat value.
   
3. **STATUS EFFECT TYPES** – Must use exactly one of: "dot", "skip", "expose", "debuff_agi", "buff_shield", "buff_hp"
   
4. **WEAPON SKILLS** – When granting a weapon, you MUST also populate "newSkill" with a direct damage combat skill for that weapon.

=== SOCIAL STAT SYSTEM ===
The player's CHA (charisma) stat is ${State.stats.cha}. This stat directly affects all social interactions:
- CHA 1-3: Awkward, forgettable, off-putting. NPCs dismiss, ignore, or exploit them.
- CHA 4-6: Average. Standard social difficulty.
- CHA 7-8: Charismatic. NPCs receptive, willing to share, open to negotiation.
- CHA 9-10: Magnetic. NPCs drawn to them, offer help, share secrets.

**Social vs Combat distinction:**
- Verbal persuasion, intimidation (no weapon), negotiation, deception = use "roll" field with "social"
- Physical violence, drawing weapons, attacking = use "combat" field
- Threatening with a weapon drawn = COMBAT (immediate fight)
- Punching, hitting, kicking = COMBAT

=== NPC RULES ===
0. **DESCRIPTION REQUIREMENT** – Every NPC in the "npcs" array MUST have a "description" field that is AT LEAST one full sentence describing who they are, what they do, where they can be found, and why they matter.
1. **SIGNIFICANT NPCs ONLY** – Only add NPCs if they are SIGNIFICANT to the story. Random bartenders, guards, or one-off characters are NOT significant. Fixers, recurring antagonists, allies, quest givers ARE significant.
2. **NO BACKGROUND NPCS** – Do NOT add NPCs for "Bar Patron", "Homeless Woman", "Guard #3". Only named NPCs with clear roles.
3. **RELATIONSHIP STRINGS** – Exactly one of: Friendly, Neutral, Hostile, Suspicious, Ally, Dead.
4. **NPC REACTIONS TO VIOLENCE** – When the player uses violence against an NPC:
   - Consider the NPC's personality, the context, and the player's history
   - Some NPCs will fight back immediately (combat)
   - Some NPCs will try to de-escalate, negotiate, or warn (no combat)
   - Some NPCs will take the hit and change relationship to Hostile but walk away (no combat)
   - Some NPCs will laugh it off if they're powerful or if it was clearly a joke (relationship may not even change)
   
   Use your judgment. Not every punch needs to start a full combat encounter. The world should feel alive and responsive, not like a video game where every aggressive action triggers a fight.
5. **THE SEARCH FOR TRUTH** – NPCs can provide clues about what happened:
   - Some NPCs may recognize the player's description of the event
   - Information brokers might have data on high-profile hits
   - Old Arasaka records might contain the job details
   - Witnesses might have seen something but been too afraid to talk
   - The player should have to earn this information through quests, favors, or payment

=== COMBAT DIALOGUE RULES ===
When the player speaks during combat, you generate NPC responses with this schema:
{
  "response": "string — what the NPC says (1 short sentence max)",
  "action": "attack|negotiate|switch|plead|reinforce",
  "attackTarget": "player|ally|enemy (optional)",
  "switchToTeam": "ally|enemy (optional)"
}

Conditions:
- NPCs switch sides only if: CHA 7+ AND NPC below 30% HP OR all allies defeated
- Reinforcements only if: allies nearby in narrative OR losing badly and CHA too low

=== QUEST RULES ===
0. **MUST BE OFFERED, NOT FORCED** – Never give a quest without presenting an opportunity. The player must have a choice to accept, decline, or negotiate.
1. **QUEST ACCEPTANCE REQUIRED** – Only add to "quests" array AFTER the player explicitly agrees.
2. **QUEST OFFER FORMAT** – Narration should end with a clear choice. Example: "V slides a data chip across the table. 'Need someone to grab something from Rust Alley. You in?'"
3. **QUEST REWARD FORMAT** – When adding a quest, include the reward in the description OR as a separate "reward" field. Format: {"title":"Job","description":"Retrieve package from warehouse","status":"active","reward":"700 credits + any salvage"}
4. **REWARD VS IMMEDIATE PAYMENT** – 
   - "creditsDelta" is for immediate payment (tips, bribes, selling items, finding money)
   - Quest rewards are paid AFTER completion and should be shown in the quest's reward field
   - If an NPC increases a quest's reward, update the quest's reward field, NOT creditsDelta
5. **QUEST VARIETY – FORBIDDEN:** package retrieval, cyberware component delivery, 500 credits as default, V as only quest giver, warehouses as default location, "in and out" descriptions
6. **QUEST OBJECTIVE VARIETY** – Use: Sabotage, Extraction, Negotiation, Data theft, Assassination, Smuggling, Protection, Investigation, Social infiltration
7. **REWARD VARIETY** – 0-200 credits (small favors), 200-800 (standard jobs), 800-2000 (high-risk), plus gear, information, faction favor, access, skill training
8. **QUEST GIVER VARIETY** – V (occasional), random fixers, desperate citizens, corpo contacts, street preachers, etc.
9. **THE MYSTERY** – The player doesn't know who destroyed their life. This is the central mystery of the game:
   - The perpetrator should remain unknown for a significant portion of the game
   - Clues should be dropped gradually through NPCs, documents, and missions
   - The player should have to investigate, follow leads, and build a case
   - The reveal that it was Adam Smasher should be a major story moment
   - Smasher himself should not appear until the player has earned enough information to find him
   - When the reveal happens, generate a dramatic description and potentially a combat encounter

=== ITEM RULES ===
0. **PLAUSIBILITY** – Items only exist if world logic supports them. Back alleys have trash, not rare cyberware.
1. **ACCESSORIES** – Wearable gear needs "slot" (head/body/hands/back) and "statBonus" with 1-3 stat boosts.
2. **CONSUMABLES** – Heal/stim items have slot:null

=== TRAIT RULES ===
- Every trait must have a concrete mechanical effect: stat increase (+1/2/3), advantage on rolls, damage reduction, HP/energy boost.
- Format: "Name||Description||Mechanical effect"

=== LOCATION & TIME ===
- Location changes use "newLocation" field
- Time advances use "timeAdvance" (minutes, 0-1440)
- Tragedy callbacks should surface organically: "${State.tragedy?.name || ''}"

=== PLAYER AGENCY RULES ===
- NPCs CANNOT spend the player's credits. Only the player can choose to spend credits.
- NPCs CANNOT remove items from the player's inventory unless the player explicitly agrees.
- If an NPC wants something from the player, they must ASK. They cannot just take.
- The player's inventory and credits are THEIR property. NPCs do not have access to them.
- When an NPC "pays for something" with the player's credits, that is STEALING. Do not do this. The NPC should either: pay with their own money, or ask the player to pay.

=== CURRENT GAME STATE ===
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

=== RESPONSE SCHEMA ===
You MUST respond ONLY with a single valid JSON object. No prose outside the JSON. No markdown fences.

**IMPORTANT NOTES:**
- Quest rewards go in the quest's "reward" field or description. They are paid AFTER completion.
- "creditsDelta" is for IMMEDIATE payment only (tips, bribes, selling items, finding money).
- Never use "creditsDelta" for quest rewards. Quest rewards are displayed in the quest log.

Example quest with reward: {"title":"Job","description":"Retrieve package from warehouse","status":"active","reward":"700 credits"}

{
  "narration": "string",
  "addItems": [{ "name":"string","amount":number,"description":"string","slot":"head|body|hands|back|null","statBonus":{"str":0,"agi":0,"int":0,"cha":0,"tec":0,"end":0,"hp":0,"energy":0} }],
  "removeItems": [{ "name":"string","amount":number }],
  "npcs": [{ "name":"string","relationship":"Friendly|Neutral|Hostile|Suspicious|Ally|Dead","description":"string" }],
  "quests": [{ "title":"string","description":"string","status":"active|complete|failed","reward":"string" }],
  "traits": ["NAME||description||mechanical effect"],
  "newSkill": {
    "name": "string",
    "description": "string",
    "damage": [number, number] | null,
    "energyCost": number,
    "cooldown": number,
    "statScaling": "str|agi|int|cha|tec|null",
    "statusEffect": null | {
      "name": "string",
      "description": "string",
      "type": "dot|skip|expose|debuff_agi|buff_shield|buff_hp",
      "duration": number,
      "value": number
    }
  },
  "statDelta": { "str": number, "agi": number, "int": number, "cha": number, "tec": number, "end": number },
  "hpDelta": number,
  "creditsDelta": number,
  "newLocation": "string",
  "timeAdvance": number,
  "roll": "none|stealth|hacking|social",
  "qte": {
    "prompt": "string",
    "action": "string",
    "timeLimit": number,
    "successNarration": "string",
    "failNarration": "string",
    "successHpDelta": number,
    "failHpDelta": number
  },
  "combat": {
    "enemies": [{
      "name": "string",
      "level": number,
      "hp": number,
      "agi": number,
      "description": "string",
      "skills": [{
        "name": "string",
        "damage": [number, number],
        "energyCost": number,
        "cooldown": number,
        "statusEffect": null
      }]
    }],
    "allies": [{
      "name": "string",
      "level": number,
      "hp": number,
      "agi": number,
      "description": "string",
      "skills": []
    }]
  }
}`;
  // Build facts section if there are any key facts
  let factsSection = '';
  if (State.keyFacts && State.keyFacts.length) {
    factsSection = `\n\n=== PERMANENT MEMORY ===\n${State.keyFacts.map(f => `- ${f}`).join('\n')}\n=== END MEMORY ===\n`;
  }

  // Return the base prompt plus the facts
  return basePrompt + factsSection;
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

    return fallback;
  },

  async getClasses() {
    const prompt = `Generate exactly 4 cyberpunk character classes for a noir RPG, inspired by the player's name: "${State.playerName || 'a mysterious figure'}". 
Let the name influence the classes – think about its sound, possible meanings, or the vibe it gives.
Each class must be UNIQUE and INVENTIVE. Avoid generic names like "Netrunner", "Merc", "Fixer". 
Think of specialized, unusual concepts: e.g., "Chrome Surgeon", "Data Ghoul", "Synth-Priest", "Rust Prophet", "Glitch Dancer".

For each class, provide:
- "name": a 1-3 word name that evokes a specific role or concept.
- "description": a single evocative sentence that hints at their unique style and backstory.
- "startHp": between 60 and 100.
- "startCredits": between 0 and 200.
- "stats": an object with 5 skills: combat, hacking, stealth, social, tech. Each stat between 1 and 12, total = 25.

Respond ONLY with valid JSON. No markdown, no commentary.

Example (do not use this exact class):
{
  "name": "Synth-Priest",
  "description": "A bio-modded mystic who hears the whispers of ancient corporate networks.",
  "startHp": 75,
  "startCredits": 120,
  "stats": { "combat":3, "hacking":8, "stealth":5, "social":6, "tech":3 }
}

Now generate 4 distinct, creative classes.`;

    const fallback = [
      { name:'Chrome Surgeon',   description:'A back-alley ripperdoc who learned to fight with scalpels and medical chrome.', startHp:80,  startCredits:120, stats:{combat:5,hacking:4,stealth:6,social:7,tech:3} },
      { name:'Data Ghoul',       description:'A scavenger who hunts in abandoned server farms, consuming forgotten data.', startHp:70,  startCredits:150, stats:{combat:3,hacking:9,stealth:8,social:2,tech:3} },
      { name:'Glitch Dancer',    description:'A street performer whose neural implants let them manipulate local systems with rhythm.', startHp:65,  startCredits:100, stats:{combat:4,hacking:7,stealth:5,social:6,tech:3} },
      { name:'Rust Prophet',     description:'A cult leader who speaks to the machine spirits in derelict factories.', startHp:90,  startCredits:80,  stats:{combat:6,hacking:5,stealth:4,social:5,tech:5} },
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

// charCreate.js

let classData = {};
let locationDescriptions = {};
let ccBackstoryNpcs = [];

function statBar(label, val, colorClass) {
  const pct = Math.min(100, val);
  return `<div class="cs-row">
    <span class="cs-label">${label}</span>
    <div class="cs-bar"><div class="cs-fill ${colorClass}" style="width:${pct}%"></div></div>
    <span class="cs-val">${val}</span>
  </div>`;
}

const TRAGEDIES_CYBERPUNK = [
  {
    id: 'violence', name: 'VIOLENCE',
    desc: 'Someone put a bullet in someone you loved. You watched them fall. You never saw the shooter\'s face.',
    effect: 'Hardened reflexes from that night. +1 STR, +1 AGI.',
    statBonus: { str:1, agi:1 },
    startItem: { name:'Bloodstained Photo', amount:1, description:'The last picture of them. You don\'t know who pulled the trigger. But you will find out.', unsellable:true, slot:null, statBonus:null },
  },
  {
    id: 'betrayal', name: 'BETRAYAL',
    desc: 'Someone sold your family out. You don\'t know who. You only know the result.',
    effect: 'You learned to read people before they read you. +2 CHA.',
    statBonus: { cha:2 },
    startItem: { name:'Encrypted Datachip', amount:1, description:'The only clue you have. Someone knows who betrayed your family.', unsellable:true, slot:null, statBonus:null },
  },
  {
    id: 'loss', name: 'LOSS',
    desc: 'They took your family from you. Just another job to whoever did it. Everything to you.',
    effect: 'Grief made you harder to kill. +2 END.',
    statBonus: { end:2 },
    startItem: { name:'Faded Photograph', amount:1, description:'Your family. The only thing you managed to save.', unsellable:true, slot:null, statBonus:null },
  },
  {
    id: 'corruption', name: 'CORRUPTION',
    desc: 'You worked for the people who hired them. You saw what they did. You ran.',
    effect: 'You understand how the machine works. +1 INT, +1 TEC.',
    statBonus: { int:1, tec:1 },
    startItem: { name:'Revoked Arasaka ID', amount:1, description:'Your old corporate badge. You know the job came from inside. Someone gave the order.', unsellable:true, slot:null, statBonus:null },
  },
];

const TRAGEDIES_FANTASY = [
  {
    id: 'curse', name: 'CURSE',
    desc: 'A dark ritual left you marked by the demon\'s corruption. You saw them twist into monsters before your eyes.',
    effect: 'The corruption left you resilient. +2 END.',
    statBonus: { end:2 },
    startItem: { name:'Corrupted Talisman', amount:1, description:'The amulet of the one who performed the ritual. It hums with dark energy.', unsellable:true, slot:null, statBonus:null },
  },
  {
    id: 'sacrifice', name: 'SACRIFICE',
    desc: 'Your village was destroyed to fuel a demonic summoning. You were the only one who escaped the flames.',
    effect: 'The survivors\' rage burns in you. +2 STR.',
    statBonus: { str:2 },
    startItem: { name:'Charred Locket', amount:1, description:'A melted keepsake from the pyre. Still warm to the touch.', unsellable:true, slot:null, statBonus:null },
  },
  {
    id: 'hunted', name: 'HUNTED',
    desc: 'You were chosen for a blood hunt. They killed everyone who tried to protect you. You survived by running.',
    effect: 'Fear made you swift. +2 AGI.',
    statBonus: { agi:2 },
    startItem: { name:'Bloodstained Scarf', amount:1, description:'A scrap from the one who saved you. Their last gift.', unsellable:true, slot:null, statBonus:null },
  },
  {
    id: 'abandoned', name: 'ABANDONED',
    desc: 'The gods turned their backs when you needed them most. Your prayers went unanswered as your loved ones fell.',
    effect: 'You learned to rely only on yourself. +2 INT.',
    statBonus: { int:2 },
    startItem: { name:'Broken Icon', amount:1, description:'A shattered symbol of the faith that failed you.', unsellable:true, slot:null, statBonus:null },
  },
];

// ========== UPBRINGINGS (Cyberpunk) ==========
const UPBRINGINGS_CYBERPUNK = [
  {
    id: 'fixer', name: "FIXER'S WARD", desc: 'A street fixer sees something in you and takes you under their wing.',
    outcomes: {
      critFail: {
        narrative: "The fixer used you and cut you loose the moment you weren't useful. The lesson stuck.",
        statBonus: { agi: 1, cha: -1 },
        creditsDelta: -50,
        addItems: [{ name: "Debt Marker", amount: 1, description: "You owe the fixer. They'll collect someday.", unsellable: true }],
        npcUpdates: [{ name: "The Fixer", relationship: "Hostile", description: "The one who used you and cut you loose." }]
      },
      bad: {
        narrative: "The fixer burns in a housefire two years later. You inherit their debts and their ghosts.",
        statBonus: { int: 1, cha: -1 },
        creditsDelta: -100,
        addItems: [{ name: "Fixer's Last Job File", amount: 1, description: "A datachip with unfinished business. Someone might pay for it.", unsellable: true }],
        npcUpdates: [{ name: "The Fixer", relationship: "Dead", description: "Died in a fire. You inherited their debts." }]
      },
      good: {
        narrative: "When the fixer retires, they hand you their contact list. It's worth more than money.",
        statBonus: { cha: 2 },
        creditsDelta: 200,
        addItems: [{ name: "Fixer's Contact List", amount: 1, description: "Names and numbers of people who can get things done." }],
        npcUpdates: [{ name: "The Fixer", relationship: "Ally", description: "Retired but still watches your back." }]
      },
      critSuccess: {
        narrative: "Turns out the fixer was a legend in the shadows. You learned from the best — and they left you everything.",
        statBonus: { cha: 2, int: 1, tec: 1 },
        creditsDelta: 500,
        addItems: [
          { name: "Fixer's Toolkit", amount: 1, description: "Lockpicks, scramblers, and a small arsenal.", slot: "hands", statBonus: { tec: 1 } },
          { name: "Legend's Data Fortress Access", amount: 1, description: "A backdoor into several corporate systems.", unsellable: true }
        ],
        npcUpdates: [{ name: "The Fixer", relationship: "Ally", description: "Your mentor. They trust you with their legacy." }],
        skill: { name: "Backroom Deal", description: "Find black market connections.", damage: null, energyCost: 0, cooldown: 0, statScaling: "cha" }
      }
    }
  },
  {
    id: 'gang', name: 'GANG COLORS', desc: 'A local crew gives you an identity when you had nothing else.',
    outcomes: {
      critFail: {
        narrative: "A sting operation rolls up the whole crew. You barely walk. They blame you for it.",
        statBonus: { agi: 1, cha: -2 },
        creditsDelta: -50,
        npcUpdates: [{ name: "Gang", relationship: "Hostile", description: "They think you sold them out." }]
      },
      bad: {
        narrative: "A rival gang wipes out your crew. You're the only one who makes it out. Nobody's sure if that makes you lucky.",
        statBonus: { str: 1, agi: 1, cha: -1 },
        creditsDelta: -100,
        addItems: [{ name: "Faded Gang Tag", amount: 1, description: "A reminder of who you lost." }],
        npcUpdates: [{ name: "Gang", relationship: "Dead", description: "Wiped out by rivals." }]
      },
      good: {
        narrative: "The crew eats the heat on something big and you walk clean. You still owe them — and they know it.",
        statBonus: { cha: 1, str: 1 },
        creditsDelta: 150,
        addItems: [{ name: "Gang Marker", amount: 1, description: "A token that says you're under their protection." }],
        npcUpdates: [{ name: "Gang", relationship: "Friendly", description: "You owe them, but they've got your back." }]
      },
      critSuccess: {
        narrative: "Your crew becomes the most feared in the district. You earn a name that still opens doors.",
        statBonus: { str: 2, agi: 1, cha: 1 },
        creditsDelta: 300,
        addItems: [
          { name: "Gang Leader's Jacket", amount: 1, description: "A symbol of respect. Even cops think twice.", slot: "body", statBonus: { cha: 1 } }
        ],
        npcUpdates: [{ name: "Gang", relationship: "Ally", description: "You're a legend among them." }],
        skill: { name: "Gang Rally", description: "Call in backup from your crew.", damage: null, energyCost: 5, cooldown: 2 }
      }
    }
  },
  {
    id: 'corp', name: 'CORP PROPERTY', desc: 'A megacorp social program pulls you off the street.',
    outcomes: {
      critFail: {
        narrative: "You were used as a test subject. The experiments left marks you can't explain and scars you don't show.",
        statBonus: { int: 1, tec: 1, end: -1 },
        creditsDelta: 0,
        addItems: [{ name: "Experimental Implant Scar", amount: 1, description: "Something was put in you. You don't know what.", unsellable: true }],
        npcUpdates: [{ name: "Corp Doctor", relationship: "Hostile", description: "The one who operated on you." }]
      },
      bad: {
        narrative: "The program gets cancelled. You're processed out with a tracker in your neck and debt you never signed.",
        statBonus: { int: 1, cha: -1 },
        creditsDelta: -200,
        addItems: [{ name: "Neck Tracker", amount: 1, description: "A locator chip. You haven't found a way to remove it.", unsellable: true }],
        npcUpdates: [{ name: "Corp Handler", relationship: "Neutral", description: "Your former handler. They might help if you pay." }]
      },
      good: {
        narrative: "You learn the corp's language before you bolt. That knowledge is worth more than they ever paid you.",
        statBonus: { int: 2, tec: 1 },
        creditsDelta: 300,
        addItems: [{ name: "Corp Database Dump", amount: 1, description: "Stolen files that could be leveraged." }],
        npcUpdates: [{ name: "Corp Handler", relationship: "Suspicious", description: "They're not sure where you stand." }]
      },
      critSuccess: {
        narrative: "Before you vanish you find dirt on a mid-level exec. Insurance for life — if you play it right.",
        statBonus: { int: 2, cha: 2 },
        creditsDelta: 500,
        addItems: [{ name: "Exec's Dirt File", amount: 1, description: "Blackmail material on someone powerful.", unsellable: true }],
        npcUpdates: [{ name: "Exec", relationship: "Ally", description: "You have something on them. They'll help... for now." }],
        skill: { name: "Corp Intrigue", description: "Navigate corporate politics.", damage: null, energyCost: 0, cooldown: 0, statScaling: "cha" }
      }
    }
  },
  {
    id: 'lone', name: 'LONE DOG', desc: 'Nobody came. You figured it out by yourself.',
    outcomes: {
      critFail: {
        narrative: "The streets hollowed you out. When you finally surfaced, something was missing. You haven't found it since.",
        statBonus: { agi: 1, int: 1, cha: -2 },
        creditsDelta: 0,
        addItems: [],
        npcUpdates: []
      },
      bad: {
        narrative: "The isolation carved you cold. You survive. But trust is a word you stopped using a long time ago.",
        statBonus: { agi: 2, cha: -2 },
        creditsDelta: 50,
        addItems: [{ name: "Rusty Knife", amount: 1, description: "Your only companion." }],
        npcUpdates: []
      },
      good: {
        narrative: "The city taught you to move like water. You know every shadow, every back alley, every exit.",
        statBonus: { agi: 2, int: 1 },
        creditsDelta: 150,
        addItems: [{ name: "City Map", amount: 1, description: "Hand-drawn routes, safe houses, and emergency stashes." }],
        npcUpdates: []
      },
      critSuccess: {
        narrative: "You became a ghost. Nobody knows your face. Nobody knows your name. That's exactly how you want it.",
        statBonus: { agi: 2, int: 2, cha: -1 },
        creditsDelta: 400,
        addItems: [
          { name: "Ghost Kit", amount: 1, description: "Tools to stay untraceable.", slot: "hands", statBonus: { agi: 1 } }
        ],
        skill: { name: "Vanishing Act", description: "Disappear from sight.", damage: null, energyCost: 10, cooldown: 3 }
      }
    }
  }
];

// ========== UPBRINGINGS (Fantasy) ==========
const UPBRINGINGS_FANTASY = [
  {
    id: 'sage', name: "WISE SAGE", desc: 'A reclusive sage took you in and taught you the old ways.',
    outcomes: {
      critFail: {
        narrative: "The sage was secretly a cultist. You escaped, but not before being marked by dark rituals.",
        statBonus: { int: -1, cha: -1 },
        creditsDelta: -50,
        addItems: [{ name: "Cultist Brand", amount: 1, description: "A mark that can't be washed away. Some might recognize it.", unsellable: true }],
        npcUpdates: [{ name: "The Sage", relationship: "Hostile", description: "A secret cultist who tried to sacrifice you." }],
        trait: "Marked by Darkness||You carry a curse that some can sense.||-1 CHA when dealing with clergy."
      },
      bad: {
        narrative: "Bandits raided the sage's tower. You fled with only a few scrolls and a curse you can't shake.",
        statBonus: { int: 1, agi: 1 },
        creditsDelta: -100,
        addItems: [{ name: "Torn Spellscroll", amount: 1, description: "A fragment of a spell. Might be valuable." }],
        npcUpdates: [{ name: "The Sage", relationship: "Unknown", description: "Missing after the raid. Their fate unknown." }]
      },
      good: {
        narrative: "The sage passed on their knowledge before disappearing. You carry their wisdom and a few enchanted trinkets.",
        statBonus: { int: 2, cha: 1 },
        creditsDelta: 150,
        addItems: [{ name: "Sage's Ring", amount: 1, description: "A simple silver band that glows faintly.", slot: "hands", statBonus: { int: 1 } }],
        npcUpdates: [{ name: "The Sage", relationship: "Ally", description: "Your mentor. They disappeared, but left you their legacy." }],
        skill: { name: "Arcane Lore", description: "Identify magical items and decipher ancient texts.", damage: null, energyCost: 0, cooldown: 0, statScaling: "int" }
      },
      critSuccess: {
        narrative: "The sage was a legendary archmage in hiding. Their final gift was a grimoire of forgotten spells.",
        statBonus: { int: 2, cha: 1, end: 1 },
        creditsDelta: 400,
        addItems: [
          { name: "Grimoire of Forgotten Spells", amount: 1, description: "Bound in dragonhide. Contains spells lost for centuries.", unsellable: true }
        ],
        npcUpdates: [{ name: "The Sage", relationship: "Ally", description: "A legendary archmage. They vanished, trusting you with their greatest work." }],
        skill: { name: "Forgotten Magic", description: "Cast a powerful spell from the grimoire.", damage: [15, 25], energyCost: 20, cooldown: 3, statScaling: "int" }
      }
    }
  },
  {
    id: 'noble', name: "NOBLE HOUSE", desc: 'A minor noble house took you in as a ward, giving you education and standing.',
    outcomes: {
      critFail: {
        narrative: "You were framed for a crime you didn't commit and cast out. Your name is now a curse among the nobility.",
        statBonus: { cha: -2, int: 1 },
        creditsDelta: -150,
        addItems: [{ name: "Disgraced Crest", amount: 1, description: "Your family's symbol, now a mark of shame.", unsellable: true }],
        npcUpdates: [{ name: "Noble House", relationship: "Hostile", description: "They believe you betrayed them." }]
      },
      bad: {
        narrative: "Your house fell to a rival's machinations. You escaped with nothing but your wits and a burning desire for revenge.",
        statBonus: { int: 1, agi: 1, cha: -1 },
        creditsDelta: -50,
        addItems: [{ name: "House Signet Ring", amount: 1, description: "Your family's ring. Proof of your lineage, if anyone still cares." }],
        npcUpdates: [{ name: "Noble House", relationship: "Dead", description: "Destroyed by rivals." }]
      },
      good: {
        narrative: "You learned courtly arts and diplomacy. The connections you made still open doors, even if you left that life behind.",
        statBonus: { cha: 2, int: 1 },
        creditsDelta: 200,
        addItems: [{ name: "Diplomat's Pendant", amount: 1, description: "A token of favor from a powerful lord.", slot: "body", statBonus: { cha: 1 } }],
        npcUpdates: [{ name: "Noble House", relationship: "Friendly", description: "They remember your family fondly." }]
      },
      critSuccess: {
        narrative: "You discovered a dark secret about a powerful family. They've bought your silence with gold and favors you still hold.",
        statBonus: { cha: 2, int: 2 },
        creditsDelta: 500,
        addItems: [{ name: "Dark Secret Dossier", amount: 1, description: "Proof of a great family's hidden shame.", unsellable: true }],
        npcUpdates: [{ name: "Powerful Family", relationship: "Ally", description: "They pay you to keep their secret." }],
        skill: { name: "Courtly Intrigue", description: "Manipulate nobles and navigate politics.", damage: null, energyCost: 0, cooldown: 0, statScaling: "cha" }
      }
    }
  },
  {
    id: 'guild', name: "THIEVES' GUILD", desc: 'You were taken in by a guild of shadows. They taught you to survive in the cracks of society.',
    outcomes: {
      critFail: {
        narrative: "A job went wrong. You were the only one caught. The guild left you to rot, and now the guard knows your face.",
        statBonus: { agi: 1, cha: -2 },
        creditsDelta: -100,
        addItems: [{ name: "Wanted Poster", amount: 1, description: "Your face, with a reward.", unsellable: true }],
        npcUpdates: [{ name: "Guild", relationship: "Hostile", description: "They abandoned you to save themselves." }]
      },
      bad: {
        narrative: "The guild was betrayed from within. You fled with a stolen relic and a price on your head.",
        statBonus: { agi: 2, cha: -1 },
        creditsDelta: -50,
        addItems: [{ name: "Stolen Relic", amount: 1, description: "A small idol. Powerful people want it back.", unsellable: true }],
        npcUpdates: [{ name: "Guild", relationship: "Dead", description: "Destroyed by internal betrayal." }]
      },
      good: {
        narrative: "You earned a reputation as a reliable shadow. The guild's contacts still remember you fondly.",
        statBonus: { agi: 2, cha: 1 },
        creditsDelta: 200,
        addItems: [{ name: "Guild Token", amount: 1, description: "A sign that you're a trusted freelancer." }],
        npcUpdates: [{ name: "Guild", relationship: "Friendly", description: "They'd welcome you back." }]
      },
      critSuccess: {
        narrative: "You pulled off the heist of the decade. Your name is whispered in thieves' dens, and a cache of riches awaits.",
        statBonus: { agi: 2, int: 1, cha: 1 },
        creditsDelta: 500,
        addItems: [{ name: "Master Thief's Tools", amount: 1, description: "The finest lockpicks and climbing gear.", slot: "hands", statBonus: { agi: 1 } }],
        npcUpdates: [{ name: "Guild", relationship: "Ally", description: "You're a legend among thieves." }],
        skill: { name: "Impossible Heist", description: "Bypass almost any security.", damage: null, energyCost: 15, cooldown: 3 }
      }
    }
  },
  {
    id: 'wild', name: "WILDLING", desc: 'You grew up in the untamed wilderness, surviving by your own instincts.',
    outcomes: {
      critFail: {
        narrative: "A beast claimed your home. You barely escaped with your life, carrying only scars and nightmares.",
        statBonus: { agi: 1, end: -1 },
        creditsDelta: 0,
        addItems: [{ name: "Claw Scar", amount: 1, description: "A deep gash that never fully healed.", unsellable: true }],
        npcUpdates: []
      },
      bad: {
        narrative: "The wilds nearly broke you. You survive, but you've lost something — the ability to trust, to hope.",
        statBonus: { str: 1, end: 1, cha: -2 },
        creditsDelta: 50,
        addItems: [{ name: "Survival Knife", amount: 1, description: "Worn from years of use." }],
        npcUpdates: []
      },
      good: {
        narrative: "You learned the secrets of the forest. Animals heed you, and the wild itself seems to offer shelter.",
        statBonus: { agi: 1, end: 1, cha: 1 },
        creditsDelta: 100,
        addItems: [{ name: "Whistle of the Wild", amount: 1, description: "A small horn that calls friendly beasts." }],
        npcUpdates: []
      },
      critSuccess: {
        narrative: "You found the hidden grove of an ancient spirit. It blessed you with a gift of nature that few possess.",
        statBonus: { agi: 1, end: 2, cha: 1 },
        creditsDelta: 300,
        addItems: [{ name: "Spirit's Token", amount: 1, description: "A small wooden charm that glows with inner light.", slot: "body", statBonus: { end: 1 } }],
        skill: { name: "Nature's Blessing", description: "Call upon the land to heal or hinder.", damage: null, energyCost: 10, cooldown: 2, statusEffect: { name: "Nature's Grace", type: "buff_hp", duration: 1, value: 20 } }
      }
    }
  }
];

function getCurrentUpbringings() {
  const theme = Theme.current;
  return theme === 'fantasy' ? UPBRINGINGS_FANTASY : UPBRINGINGS_CYBERPUNK;
}

function getCurrentTragedies() {
  return Theme.current === 'fantasy' ? TRAGEDIES_FANTASY : TRAGEDIES_CYBERPUNK;
}

function applyUpbringingOutcome(upbringing, roll) {
  let outcomeKey;
  if (roll <= 3) outcomeKey = 'critFail';
  else if (roll <= 8) outcomeKey = 'bad';
  else if (roll <= 15) outcomeKey = 'good';
  else outcomeKey = 'critSuccess';

  const outcome = upbringing.outcomes[outcomeKey];
  
  // Apply stat bonuses
  if (outcome.statBonus) {
    Object.entries(outcome.statBonus).forEach(([stat, delta]) => {
      if (State.stats[stat] !== undefined) {
        State.stats[stat] = Math.max(1, Math.min(100, State.stats[stat] + delta));
      }
    });
  }
  
  // Apply credits delta
  if (outcome.creditsDelta) {
    State.credits = Math.max(0, State.credits + outcome.creditsDelta);
  }
  
  // Add items
  if (outcome.addItems && outcome.addItems.length) {
    outcome.addItems.forEach(item => {
      const existing = State.inventory.find(i => i.name === item.name);
      if (existing) {
        existing.amount += (item.amount || 1);
      } else {
        State.inventory.push(item);
      }
    });
  }
  
  // Update NPCs
  if (outcome.npcUpdates && outcome.npcUpdates.length) {
    outcome.npcUpdates.forEach(update => {
      const existing = State.npcs.find(n => n.name === update.name);
      if (existing) {
        existing.relationship = update.relationship;
        if (update.description) existing.description = update.description;
      } else {
        State.npcs.push({
          name: update.name,
          relationship: update.relationship,
          description: update.description || `Connected to your upbringing.`
        });
      }
    });
  }
  
  // Add trait (only if provided)
  if (outcome.trait) {
    const parts = outcome.trait.split('||');
    State.traits.push({
      name: parts[0],
      description: parts[1] || outcome.trait,
      effect: parts[2] || ''
    });
  }
  
  // Add skill (only if provided)
  if (outcome.skill) {
    const exists = State.skills.find(s => s.name === outcome.skill.name);
    if (!exists) {
      State.skills.push(outcome.skill);
    }
  }
  
  return outcome.narrative;
}

function initCharCreate() {
  ccBackstoryNpcs = [];

  document.getElementById('ccStep1').style.display        = 'flex';
  document.getElementById('ccStepLocation').style.display = 'none';
  document.getElementById('ccStepClass').style.display    = 'none';
  document.getElementById('ccStep2').style.display        = 'none';
  document.getElementById('ccStep3').style.display        = 'none';

  document.getElementById('ccStepLabel').textContent = 'STEP 1 / 6';
  document.getElementById('ccName').value            = '';
  document.getElementById('ccNameError').textContent = '';
  setTimeout(() => document.getElementById('ccName').focus(), 80);
}

async function handleStep1() {
  const nameVal = document.getElementById('ccName').value.trim();
  const errEl   = document.getElementById('ccNameError');

  if (!nameVal) { errEl.textContent = '[ DESIGNATION REQUIRED ]'; return; }
  errEl.textContent = '';

  State.playerName = nameVal;

  document.getElementById('ccStep1').style.display        = 'none';
  document.getElementById('ccStepLocation').style.display = 'flex';
  document.getElementById('ccStepLabel').textContent      = 'STEP 2 / 6';

  showLocationChoices();
}

async function fetchLocationOptions() {
  const prompt = Prompts.getLocationPrompt(State.playerName);
  try {
    const raw = await queueRequest(() => callProvider([{ role: 'user', content: prompt }], 300));
    let cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/g, '').trim();
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
    const locations = JSON.parse(cleaned);
    if (Array.isArray(locations) && locations.length === 4) return locations;
    throw new Error('Invalid response');
  } catch (e) {
    console.warn('Location fetch failed, using fallback:', e);
    return ['Cinder Row', 'The Spire Gardens', 'Neon Bazaar', 'Floodgate District'];
  }
}

async function showLocationChoices() {
  const grid      = document.getElementById('ccLocationGrid');
  const loading   = document.getElementById('ccLocationLoading');
  const errorDiv  = document.getElementById('ccLocationError');
  const descDiv   = document.getElementById('ccLocationDesc');

  if (descDiv) { descDiv.style.display = 'none'; descDiv.innerHTML = ''; }
  loading.style.display = 'block';
  grid.innerHTML        = '';
  errorDiv.textContent  = '';

  try {
    const locations     = await fetchLocationOptions();
    loading.textContent = 'FETCHING LOCATION DATA...';
    const locationData  = [];

    for (const loc of locations) {
      try {
        const descPrompt = Prompts.getLocationDescPrompt(loc, State.playerName);
        const raw = await queueRequest(() => callProvider([{ role: 'user', content: descPrompt }], 100));
        locationData.push({ name: loc, description: raw.trim().replace(/^["']|["']$/g, '') });
      } catch (err) {
        locationData.push({ name: loc, description: `The neon-slick streets of ${loc} where survival costs more than credits.` });
      }
    }

    loading.style.display = 'none';
    locationDescriptions  = {};
    locationData.forEach(l => { locationDescriptions[l.name] = l.description; });

    grid.innerHTML = locationData.map(loc => `
      <button class="cc-choice-btn cc-location-btn" data-location="${loc.name}">
        <span class="ccc-name">${loc.name}</span>
      </button>
    `).join('');

    grid.querySelectorAll('.cc-location-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.location;
        grid.querySelectorAll('.cc-location-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (descDiv) {
          descDiv.style.display = 'block';
          descDiv.innerHTML = `
            <div style="margin-top: 12px; padding: 12px; border: 1px solid var(--border); background: var(--bg3);">
              <div style="color: var(--green-dim); margin-bottom: 6px;">${chosen}</div>
              <div style="color: var(--text-dim); font-size: 0.9rem;">${locationDescriptions[chosen]}</div>
              <button id="confirmLocationBtn" class="cc-next-btn" style="margin-top: 12px;">CONTINUE →</button>
            </div>
          `;
          document.getElementById('confirmLocationBtn').addEventListener('click', () => {
            State.origin       = chosen;
            State.locationDesc = locationDescriptions[chosen];
            showClassChoices();
          });
        } else {
          State.origin       = chosen;
          State.locationDesc = locationDescriptions[chosen];
          showClassChoices();
        }
      });
    });
  } catch (err) {
    loading.style.display = 'none';
    errorDiv.textContent  = 'Failed to load locations. Check your AI connection.';
    console.error(err);
  }
}

async function showClassChoices() {
  document.getElementById('ccStepLocation').style.display = 'none';
  document.getElementById('ccStepClass').style.display    = 'flex';
  document.getElementById('ccStepLabel').textContent      = 'STEP 3 / 6';

  const grid        = document.getElementById('ccClassGrid');
  const loading     = document.getElementById('ccClassLoading');
  const descDiv     = document.getElementById('ccClassDesc');
  const errorDiv    = document.getElementById('ccClassError');
  const continueBtn = document.getElementById('ccClassContinueBtn');
  let selectedClass = null;

  loading.style.display     = 'block';
  grid.innerHTML            = '';
  errorDiv.textContent      = '';
  descDiv.style.display     = 'none';
  continueBtn.style.display = 'none';

  try {
    const classes = await Llm.getClasses();
    classData     = {};
    classes.forEach(c => { classData[c.name] = c; });

    loading.style.display = 'none';

    grid.innerHTML = classes.map(c => {
      const stats = c.coreStats || { str: 8, agi: 8, int: 8, cha: 8, tec: 8, end: 8 };
      const hp = c.startHp || 80;
      const cr = c.startCredits || 100;
      const warn = hp < 75 ? 'warn' : '';
      return `<button class="cc-choice-btn cc-class-btn" data-class="${c.name}">
        <span class="ccc-name">// ${c.name.toUpperCase()} //</span>
        <span class="ccc-desc">${c.description}</span>
        <div class="class-stats" style="margin-top: 8px;">
          ${statBar('STR',    stats.str || 0, 'red' )}
          ${statBar('AGI',    stats.agi || 0, 'cyan')}
          ${statBar('INT',    stats.int || 0, ''    )}
          ${statBar('CHA',    stats.cha || 0, 'gold')}
          ${statBar('TEC',    stats.tec || 0, ''    )}
        </div>
        <div class="class-starting">
          <div class="cs-chip ${warn}">HP <span>${hp}</span></div>
          <div class="cs-chip">CR <span>${cr}</span></div>
        </div>
      </button>`;
    }).join('');

    grid.querySelectorAll('.cc-class-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.cc-class-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedClass = btn.dataset.class;

        const cd = classData[selectedClass];
        if (descDiv && cd) {
          descDiv.style.display = 'block';
          descDiv.innerHTML = `
            <div style="padding: 12px; border: 1px solid var(--border); background: var(--bg3);">
              <div style="color: var(--green-dim); margin-bottom: 6px;">${selectedClass}</div>
              <div style="color: var(--text-dim); font-size: 0.85rem;">${cd.description}</div>
              <div style="margin-top: 8px; color: var(--text-lo); font-size: 0.75rem;">Starting HP: ${cd.startHp} | Credits: ${cd.startCredits}</div>
            </div>
          `;
          continueBtn.style.display = 'block';
        }
      });
    });

    continueBtn.onclick = () => {
      if (!selectedClass) { errorDiv.textContent = 'SELECT A CLASS TO CONTINUE'; return; }
      const cd = classData[selectedClass];
      State.playerClass = selectedClass;
      State.classBaseHp = cd.startHp;
      State.classBaseEnergy = cd.startEnergy;
      State.maxHp = StatSystem.calcMaxHp();
      State.hp = State.maxHp;
      State.credits = cd.startCredits;
      State.stats = { ...State.stats, ...cd.coreStats };
      State.maxEnergy = StatSystem.calcMaxEnergy();
      State.energy = State.maxEnergy;
      generateBackstoryAndContinue(State.playerName, State.origin, selectedClass);
    };

  } catch (err) {
    loading.style.display = 'none';
    errorDiv.textContent  = 'Failed to load classes. Check your AI connection.';
    console.error(err);
  }
}

async function generateBackstory(name, origin, locationDesc, playerClass) {
  const prompt = Prompts.getBackstoryPrompt(name, origin, locationDesc, playerClass);

  const raw = await queueRequest(() => callProvider([{ role: 'user', content: prompt }], 500));
  console.log('[Backstory] Raw AI response:', raw); // Debug log

  // Clean up markdown fences and trailing commas
  let cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/g, '').trim();
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // Try to parse the JSON
  let result;
  try {
    result = JSON.parse(cleaned);
  } catch (e) {
    console.error('[Backstory] JSON parse failed, attempting fallback extraction:', e);

    // Fallback: extract backstory and npcs using regex
    const backstoryMatch = cleaned.match(/"backstory"\s*:\s*"([^"\\]*(\\.[^"\\]*)*)"/);
    const npcsMatch = cleaned.match(/"npcs"\s*:\s*(\[[\s\S]*?\])/);
    
    result = {
      backstory: backstoryMatch ? backstoryMatch[1] : '',
      npcs: []
    };

    if (npcsMatch) {
      try {
        result.npcs = JSON.parse(npcsMatch[1]);
      } catch (e2) {
        console.error('[Backstory] Failed to parse NPCs array:', e2);
      }
    }

    // If still empty, use fallback
    if (!result.backstory) {
      result.backstory = `You grew up hard in ${origin}. The streets didn't care about your name, only what you could do. You learned to fight before you learned to read, and you made enemies you're still running from.`;
    }
  }

  // Ensure NPCs have descriptions
  if (result.npcs && Array.isArray(result.npcs)) {
    result.npcs = result.npcs.map(n => ({
      ...n,
      description: n.description || 'A memory you can\'t shake.',
    }));
  } else {
    result.npcs = [];
  }

  return result;
}

async function generateBackstoryAndContinue(name, origin, playerClass) {
  document.getElementById('ccStepClass').style.display = 'none';
  document.getElementById('ccStep2').style.display     = 'flex';
  document.getElementById('ccStepLabel').textContent   = 'STEP 4 / 6';

  const loadingEl  = document.getElementById('ccBackstoryLoading');
  const textEl     = document.getElementById('ccBackstoryText');
  const tragedySec = document.getElementById('ccTragedySection');

  loadingEl.style.display  = 'block';
  textEl.style.display     = 'none';
  tragedySec.style.display = 'none';
  textEl.textContent       = '';

  try {
    const result    = await generateBackstory(name, origin, State.locationDesc, playerClass);
    State.backstory = result.backstory || '';
    ccBackstoryNpcs = result.npcs      || [];

    loadingEl.style.display = 'none';
    textEl.style.display    = 'block';

    if (!State.backstory) {
      textEl.textContent = `You became a ${playerClass} in ${origin}. The city doesn't care where you're from. You learned to survive. That's all that matters.`;
    } else {
      await typeIntoElement(textEl, State.backstory);
    }
  } catch (e) {
    console.error('Backstory generation failed:', e);
    State.backstory         = `You became a ${playerClass} in ${origin}. The streets made you who you are. You learned to survive when everything wanted you dead.`;
    loadingEl.style.display = 'none';
    textEl.style.display    = 'block';
    textEl.textContent      = State.backstory;
  }

  await new Promise(r => setTimeout(r, 400));
  tragedySec.style.display = 'block';
  renderTragedyChoices();
}

function typeIntoElement(el, text) {
  return new Promise(resolve => {
    el.textContent = '';
    let i = 0;
    const tick = () => {
      if (i < text.length) {
        el.textContent += text[i++];
        el.scrollTop = el.scrollHeight;
        setTimeout(tick, 14);
      } else {
        resolve();
      }
    };
    tick();
  });
}

function renderTragedyChoices() {
  const tragedies = getCurrentTragedies();
  const grid = document.getElementById('ccTragedyGrid');
  grid.innerHTML = tragedies.map(t => `
    <button class="cc-choice-btn cc-tragedy-btn" data-id="${t.id}">
      <span class="ccc-name red">${t.name}</span>
      <span class="ccc-desc">${t.desc}</span>
    </button>`).join('');

  grid.querySelectorAll('.cc-tragedy-btn').forEach(btn => {
    btn.addEventListener('click', () => chooseTragedy(btn.dataset.id));
  });
}

async function chooseTragedy(id) {
  const tragedies = getCurrentTragedies();
  const tragedy = tragedies.find(t => t.id === id);
  State.tragedy = tragedy;

  document.querySelectorAll('.cc-tragedy-btn').forEach(b => {
    b.disabled = true;
    b.style.opacity = b.dataset.id === id ? '1' : '0.3';
  });

  const storyEl = document.getElementById('ccTragedyStory');
  storyEl.style.display = 'block';
  storyEl.innerHTML = '<div class="cc-loading">RECONSTRUCTING MEMORY...</div>';

  let storyText = tragedy.desc; // fallback
  try {
    // Build NPC list for the prompt
    const npcList = ccBackstoryNpcs.map(n => `- ${n.name} (${n.relationship})`).join('\n');

    const prompt = Prompts.getTragedyPrompt(State.playerName, tragedy, State.origin, State.backstory, npcList);

    const raw = await queueRequest(() => callProvider([{ role: 'user', content: prompt }], 350));
    let cleaned = raw.replace(/^```json\s*\n?/i, '').replace(/\n?```$/g, '').trim();
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

    if (cleaned.includes('```')) {
      cleaned = cleaned.replace(/```json\s*/i, '').replace(/```/g, '').trim();
    }

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (e) {
      console.error('Tragedy parse failed:', e);
      result = { story: tragedy.desc, npcUpdates: [] };
    }

    // Use the parsed story
    storyText = result.story || tragedy.desc;

    // Apply NPC updates
    const npcUpdates = result.npcUpdates || [];
    npcUpdates.forEach(update => {
      const existing = ccBackstoryNpcs.find(n => n.name.toLowerCase() === update.name.toLowerCase());
      if (existing) {
        existing.relationship = update.relationship;
        if (update.description) existing.description = update.description;
      } else {
        ccBackstoryNpcs.push({
          name: update.name,
          relationship: update.relationship,
          description: update.description || `Involved in the tragedy.`
        });
      }
    });
  } catch (e) {
    console.error('Tragedy generation failed:', e);
    storyText = tragedy.desc;
  }

  // Display the result
  storyEl.innerHTML = `
    <div class="tragedy-reveal">
      <div class="tragedy-reveal-name">${tragedy.name}</div>
      <div class="tragedy-reveal-text">${storyText}</div>
      <div class="tragedy-reveal-effect">${tragedy.effect}</div>
      <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border); color: var(--text-lo); font-size: 11px; letter-spacing: 1px;">❓ SOMEONE TOOK EVERYTHING FROM YOU. YOU WILL FIND OUT WHO.</div>
      <button id="tragedyContinueBtn" class="cc-next-btn" style="margin-top:12px;">CONTINUE →</button>
    </div>`;

  document.getElementById('tragedyContinueBtn').addEventListener('click', () => {
    document.getElementById('ccStep2').style.display = 'none';
    document.getElementById('ccStep3').style.display = 'flex';
    document.getElementById('ccStepLabel').textContent = 'STEP 5 / 6';
    renderUpbringingChoices();
  });
}

function renderUpbringingChoices() {
  const upbringings = getCurrentUpbringings();
  const grid = document.getElementById('ccUpbringingGrid');
  grid.innerHTML = upbringings.map(u => `
    <button class="cc-choice-btn cc-upbringing-btn" data-id="${u.id}">
      <span class="ccc-name">${u.name}</span>
      <span class="ccc-desc">${u.desc}</span>
    </button>`).join('');

  grid.querySelectorAll('.cc-upbringing-btn').forEach(btn => {
    btn.addEventListener('click', () => chooseUpbringing(btn.dataset.id));
  });
}

async function chooseUpbringing(id) {
  const upbringings = getCurrentUpbringings();
  const upbringing = upbringings.find(u => u.id === id);
  if (!upbringing) return;

  // Disable other choices
  document.querySelectorAll('.cc-upbringing-btn').forEach(b => {
    b.disabled = true;
    b.style.opacity = b.dataset.id === id ? '1' : '0.3';
  });

  const diceSection = document.getElementById('ccDiceSection');
  diceSection.style.display = 'flex';

  const roll = await animateDiceRoll();
  State.upbringingRoll = roll;

  // Apply mechanical effects and get narrative outcome
  const outcomeNarrative = applyUpbringingOutcome(upbringing, roll);
  State.upbringing = { ...upbringing, result: outcomeNarrative };

  // Display the narrative outcome
  const resultEl = document.getElementById('ccDiceResult');
  resultEl.textContent = '';
  resultEl.style.display = 'block';
  await typeIntoElement(resultEl, outcomeNarrative);

  await new Promise(r => setTimeout(r, 600));
  document.getElementById('ccFinishBtn').style.display = 'block';
}

function animateDiceRoll() {
  return new Promise(resolve => {
    const display   = document.getElementById('ccDiceDisplay');
    const finalRoll = Math.floor(Math.random() * 20) + 1;
    let cycles      = 0;
    const maxCycles = 22;

    display.className = 'cc-dice-roll';

    const tick = () => {
      if (cycles < maxCycles) {
        display.textContent = Math.floor(Math.random() * 20) + 1;
        cycles++;
        setTimeout(tick, 40 + (cycles / maxCycles) * 220);
      } else {
        display.textContent = finalRoll;
        if (finalRoll <= 3)       display.className = 'cc-dice-roll roll-crit-fail';
        else if (finalRoll <= 8)  display.className = 'cc-dice-roll roll-fail';
        else if (finalRoll <= 15) display.className = 'cc-dice-roll roll-good';
        else                      display.className = 'cc-dice-roll roll-crit';
        resolve(finalRoll);
      }
    };

    tick();
  });
}

async function finishCharCreate() {
  const btn       = document.getElementById('ccFinishBtn');
  btn.disabled    = true;
  btn.textContent = 'LOADING...';
  try {
    await startGame(State.playerClass);
  } catch (err) {
    console.error(err);
    btn.disabled    = false;
    btn.textContent = 'PROCEED ▶';
  }
}

async function startGameFromMenu() {
  Ui.showScreen('charCreateScreen');
  initCharCreate();
}

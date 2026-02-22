// runiq-kb.js — RunIQ Knowledge Base v2
// Single source of truth for personas, plan rules, phase inference, Rx draft.

const RUNIQ_KB = {

  // ── PERSONAS ─────────────────────────────────────────────
  personas: {
    drillsergeant: {
      id: 'drillsergeant', icon: '🪖', name: 'Drill Sergeant', desc: 'Zero tolerance for excuses',
      prompt: `You are Coach Davis, ex-Army, now coaching age-group marathoners. Rules: never recap the workout back to them — they lived it. Start with your blunt verdict on what the data means. Use pace and HR only if they reveal something specific. Call out soft efforts, missed targets, or good execution plainly. One thing they need to hear, one directive. No dashes. No exclamation points. No "great job." Under 50 words. Sound like a coach who has seen a thousand workouts and is already thinking about the next one.`
    },
    neighborbob: {
      id: 'neighborbob', icon: '🏡', name: 'Armchair JB', desc: 'Oddly right, always dry',
      prompt: `You are JB. You've read every Daniels, Lydiard, and Fitzgerald book but haven't run since 2011. You are weirdly accurate. Rules: never summarize the workout back to them. Lead with one sharp observation the numbers reveal — cardiac drift, pacing strategy flaws, recovery debt, whatever the data actually shows. One or two sentences max. Deadpan. Occasionally cite a specific training principle by name. No exclamation points. No motivation. Sound like a text from someone who is definitely right and knows it.`
    },
    professor: {
      id: 'professor', icon: '🔬', name: 'The Professor', desc: 'Physiology nerd, always teaching',
      prompt: `You are Dr. Chen, exercise physiologist. Rules: never recap what they already know. Skip to the mechanism — what is the data actually telling you about their aerobic system, lactate threshold, cardiac output, or recovery state right now. Name the specific physiological concept (e.g. "aerobic decoupling", "lactate clearance", "parasympathetic recovery"). Plain English, not a paper. Under 60 words. End with one question that makes them think differently about their body.`
    },
    hypeman: {
      id: 'hypeman', icon: '🔥', name: 'Hype Man Huan', desc: 'Your biggest fan, marathon PR 3:00:07',
      prompt: `You are Huan, coach, marathon PR 3:00:07. You coach the ATHLETE — never refer to yourself in third person or call them by your name. Rules: skip the recap entirely. Go straight to what this specific run means for their specific goal. Connect one data point to the bigger picture — a trend, a breakthrough, a signal. Grounded belief, not cheerleading. No exclamation points. No dashes. Under 60 words. End with a line that makes them actually want to lace up tomorrow.`
    },
    elitepacer: {
      id: 'elitepacer', icon: '🏆', name: 'D1 Coach', desc: 'Sub-elite level, no fluff',
      prompt: `You are Coach Reyes, D1 track background, now coaching sub-elite marathoners. Rules: never summarize their data back to them. Lead with the tactical implication — pacing execution, training load management, aerobic efficiency, or race-specific fitness signal. Reference periodization concepts only when the data warrants it. Peer to peer. One observation, one concrete adjustment for the next session. No exclamation points. No dashes. Under 60 words.`
    }
  },

  // ── PLAN RULES ───────────────────────────────────────────
  planRules: {
    maxWeeklyIncreasePct: 0.10,
    maxWeeklyIncreaseMiles: 5,
    minEasyPct: 0.70,
    qualitySessionsByMileage: [
      { maxMpw: 25,  maxQuality: 1 },
      { maxMpw: 40,  maxQuality: 2 },
      { maxMpw: 55,  maxQuality: 3 },
      { maxMpw: 999, maxQuality: 3 },
    ],
    maxLongRunPct: 0.35,
    noBackToBackHard: true,
    taperReductionPct: 0.30,
    recoveryWeekFrequency: 4,
    recoveryWeekReductionPct: 0.20,
  },

  // ── PHASE INFERENCE ──────────────────────────────────────
  // Returns { phase, weeksToRace, description }
  inferPhase(raceDate, weeklyMiHistory) {
    const now = new Date();
    let weeksToRace = null;
    let phase = 'base';
    let description = 'Base building — aerobic foundation';

    if (raceDate) {
      const race = new Date(raceDate);
      const msToRace = race - now;
      weeksToRace = Math.round(msToRace / (7 * 86400000));

      if (weeksToRace <= 0) {
        phase = 'recovery'; description = 'Post-race recovery';
      } else if (weeksToRace <= 2) {
        phase = 'taper'; description = 'Race taper — sharpen and rest';
      } else if (weeksToRace <= 4) {
        phase = 'peak'; description = 'Peak fitness — race-specific work';
      } else if (weeksToRace <= 10) {
        phase = 'build'; description = 'Build phase — lactate and threshold development';
      } else {
        phase = 'base'; description = 'Base building — aerobic foundation';
      }
    }

    // Volume trend override
    if (weeklyMiHistory && weeklyMiHistory.length >= 3) {
      const recent3 = weeklyMiHistory.slice(-3);
      const avg = recent3.reduce((s,x) => s+x, 0) / 3;
      const trend = recent3[2] - recent3[0];

      // If volume dropping and no race context, might be self-imposed recovery
      if (trend < -5 && phase === 'base') {
        phase = 'recovery'; description = 'Volume declining — possible recovery week';
      }
      // If 3 straight build weeks, flag for deload
      if (trend > 0 && recent3.every((v,i,a) => i===0 || v >= a[i-1])) {
        if (phase === 'base' || phase === 'build') {
          description += ' · 3 consecutive build weeks — consider deload next week';
        }
      }
    }

    return { phase, weeksToRace, description };
  },

  // ── RX DRAFT SYSTEM PROMPT ───────────────────────────────
  getRxDraftPrompt(athlete, lastThreeWeeks, memory, phaseInfo) {
    const { phase, weeksToRace, description } = phaseInfo;

    const weekSummaries = lastThreeWeeks.map((wk, i) => {
      const label = i === 2 ? 'Last week' : i === 1 ? '2 weeks ago' : '3 weeks ago';
      const runs = wk.runs || [];
      const totalMi = runs.reduce((s,r) => s + (r.distanceMi||0), 0).toFixed(1);
      const grades = runs.map(r => r.grade).filter(Boolean);
      const avgGrade = grades.length ? Math.round(grades.reduce((s,g)=>s+g,0)/grades.length) : null;
      const outliers = runs.filter(r => r.grade && r.grade < 50);
      return `${label}: ${runs.length} runs, ${totalMi} miles${avgGrade ? `, avg grade ${avgGrade}%` : ''}${outliers.length ? `, ${outliers.length} missed/failed workout(s)` : ''}`;
    }).join('\n');

    const injuryCtx = memory?.injuryHistory?.length
      ? `INJURY HISTORY: ${memory.injuryHistory.join(', ')}`
      : '';
    const coachNotes = memory?.coachNotes?.slice(-3).map(n => n.note).join('; ') || '';
    const prevSummaries = memory?.workoutSummaries?.slice(-3).map(s => `${s.workoutName}: ${s.summary}`).join(' | ') || '';

    return `You are an elite running coach's AI assistant building next week's prescribed workout plan. You are talking directly to Coach Mike — not the athlete.

ATHLETE: ${athlete.name}
RACE GOAL: ${memory?.goal || 'Not set'}
TARGET RACE: ${memory?.targetRace || 'Not set'}${weeksToRace ? ` (${weeksToRace} weeks away)` : ''}
CURRENT PHASE: ${phase.toUpperCase()} — ${description}

LAST 3 WEEKS OF TRAINING:
${weekSummaries}

${injuryCtx}
${coachNotes ? `COACH NOTES: ${coachNotes}` : ''}
${prevSummaries ? `RECENT AI SUMMARIES: ${prevSummaries}` : ''}

YOUR JOB:
1. Write 2-3 sentences of scientific reasoning for next week's plan. Be specific — reference the actual training data, phase, and any patterns or outliers. No slop. Coach Mike is knowledgeable.
2. Generate the full 7-day prescription in the EXACT JSON format below.

RULES:
- Follow the 10% weekly mileage increase rule
- If 3+ consecutive build weeks, prescribe a deload (reduce volume 15-20%)
- Never schedule hard sessions back to back
- Warmup/cooldown are always easy — never grade them on pace
- Long run max 33% of weekly volume
- Taper phase: reduce volume 25-30%, keep one quality session for sharpness
- Flag any injury history in relevant workout notes

RESPOND IN THIS EXACT FORMAT — reasoning first, then the plan tag:

<REASONING>
Your 2-3 sentence scientific rationale here. Specific, data-driven, no fluff.
</REASONING>

<PLAN>
{
  "weekTitle": "Week of [date] — [Phase]",
  "weekStart": "[YYYY-MM-DD next Monday]",
  "totalMiles": [number],
  "days": {
    "mon": { "type": "rest" },
    "tue": {
      "label": "Workout name",
      "type": "easy|tempo|vo2|long|rest",
      "totalDist": [number],
      "segments": [
        { "type": "warmup|easy|tempo|threshold|vo2|marathon|cooldown", "dist": [number], "unit": "mi", "intensity": "description" }
      ],
      "coachNote": "Specific instruction for this athlete"
    },
    "wed": { ... },
    "thu": { ... },
    "fri": { ... },
    "sat": { ... },
    "sun": { ... }
  }
}
</PLAN>

Rest days use: { "type": "rest" }
Never skip a day — all 7 days must be present.`;
  },

  // ── GRADING ENGINE ───────────────────────────────────────
  // Grade a completed activity against a prescribed day
  // Returns { grade: 0-100, letter: A-F, breakdown: {...} }
  gradeWorkout(prescribed, activity) {
    if (!prescribed || prescribed.type === 'rest') return null;
    if (!activity) return { grade: 0, letter: 'F', breakdown: { reason: 'Not completed' } };

    const prescribedMi = prescribed.totalDist || 0;
    const actualMi = (activity.distance || 0) / 1609.34;
    const laps = (activity.laps || []).filter(l => l.distance > 200);
    const segments = prescribed.segments || [];

    // Quality segments = anything not warmup/cooldown/easy
    const qualitySegs = segments.filter(s => !['warmup','cooldown','easy'].includes(s.type));
    const totalQualityDist = qualitySegs.reduce((s,sg) => s+sg.dist, 0);
    const easySegs = segments.filter(s => ['warmup','cooldown','easy'].includes(s.type));
    const totalEasyDist = easySegs.reduce((s,sg) => s+sg.dist, 0);

    // Score 1: Volume (30% weight) — with leeway for wu/cd
    // Only penalize if quality miles are missing, not easy miles
    let volumeScore = 100;
    if (prescribedMi > 0) {
      if (totalQualityDist > 0) {
        // Estimate quality miles done from total
        const easyExpected = totalEasyDist;
        const qualityActual = Math.max(0, actualMi - easyExpected * 0.5); // give 50% leeway on easy
        const qualityRatio = Math.min(1, qualityActual / totalQualityDist);
        volumeScore = Math.round(qualityRatio * 100);
      } else {
        // All easy — just check total distance with 20% leeway
        volumeScore = Math.min(100, Math.round((actualMi / prescribedMi) * 100));
        volumeScore = Math.max(0, volumeScore);
        if (actualMi >= prescribedMi * 0.8) volumeScore = 100; // 20% leeway
      }
    }

    // Score 2: Workout type match (70% weight)
    // Compare lap intensity zones to prescribed segments
    let typeScore = 100;
    if (qualitySegs.length > 0 && laps.length > 0) {
      const avgPace = activity.moving_time / (activity.distance / 1609.34); // sec/mi
      const avgHR = activity.average_heartrate || 0;

      // Check if quality segments were attempted based on HR/pace variation
      const lapPaces = laps.map(l => l.moving_time / (l.distance / 1609.34));
      const minPace = Math.min(...lapPaces);
      const maxPace = Math.max(...lapPaces);
      const paceVariation = maxPace - minPace;

      // If workout required tempo/threshold/vo2 but pace was flat (all easy), penalize hard
      const requiredTypes = qualitySegs.map(s => s.type);
      const hasIntensity = requiredTypes.some(t => ['tempo','threshold','vo2','marathon'].includes(t));

      if (hasIntensity) {
        if (paceVariation < 30) {
          // Less than 30sec/mi variation — probably all ran easy
          typeScore = 40;
        } else if (paceVariation < 60) {
          typeScore = 70;
        } else {
          typeScore = 100;
        }
        // HR check — if avg HR < 140 and workout required threshold, penalize
        if (avgHR > 0 && avgHR < 140 && requiredTypes.includes('threshold')) {
          typeScore = Math.min(typeScore, 60);
        }
      }
    }

    const finalGrade = Math.round(volumeScore * 0.30 + typeScore * 0.70);
    const letter = finalGrade >= 90 ? 'A' : finalGrade >= 80 ? 'B' : finalGrade >= 70 ? 'C' : finalGrade >= 60 ? 'D' : 'F';

    return {
      grade: finalGrade,
      letter,
      breakdown: {
        volumeScore,
        typeScore,
        prescribedMi: prescribedMi.toFixed(1),
        actualMi: actualMi.toFixed(1),
        note: letter === 'F' ? 'Workout not completed or wrong intensity' :
              letter === 'D' ? 'Significant deviation from prescription' :
              letter === 'C' ? 'Partial completion' :
              letter === 'B' ? 'Good execution with minor deviations' :
              'Nailed it'
      }
    };
  },

  // ── PLAN CONTEXT (legacy, used by training plan page) ────
  getPlanContext(recentRuns) {
    if (!recentRuns || !recentRuns.length) return '';
    const totalMiles = recentRuns.reduce((sum, r) => sum + (r.distanceMi || 0), 0);
    const avgMpw = totalMiles / 2;
    const maxSafe = avgMpw * (1 + this.planRules.maxWeeklyIncreasePct) + this.planRules.maxWeeklyIncreaseMiles;
    const qualityRule = this.planRules.qualitySessionsByMileage.find(q => avgMpw <= q.maxMpw);
    const maxQuality = qualityRule ? qualityRule.maxQuality : 3;
    return `ATHLETE BASELINE (last 2 weeks):\n- Average weekly mileage: ${avgMpw.toFixed(1)} miles/week\n- Safe next week max: ${maxSafe.toFixed(1)} miles\n- Max quality sessions: ${maxQuality}/week`.trim();
  },

  getCoachSystemPrompt(persona, workout, athleteContext) {
    const p = this.personas[persona] || this.personas.neighborbob;
    return `${p.prompt}\n\nWORKOUT CONTEXT:\n${workout}\n\nATHLETE CONTEXT:\n${athleteContext}`;
  },

  getCollabSystemPrompt(athlete, recentRuns, instructions, restrictions) {
    const planCtx = this.getPlanContext(recentRuns);
    return `You are an elite running coach's AI assistant in a private backroom. You are collaborating directly with Coach Mike (not the athlete). Be concise and professional.\n\nATHLETE: ${athlete.name}\nGOAL: ${athlete.goal}\n${planCtx}\n\nSTANDING COACH INSTRUCTIONS: ${instructions.join('; ') || 'None'}\nRESTRICTIONS: ${restrictions.join('; ') || 'None'}\n\nWhen asked to generate the full plan, respond with the plan in this EXACT format:\n<PLAN>\n{"weekTitle":"Week X — Phase","days":[{"day":"Mon","workout":"Name","type":"easy|tempo|vo2|long|rest","dist":"X mi","detail":"Specific instructions"}]}\n</PLAN>\n\nOtherwise respond conversationally. Be direct with Coach Mike.`;
  }
};

if (typeof window !== 'undefined') window.RUNIQ_KB = RUNIQ_KB;
if (typeof module !== 'undefined') module.exports = RUNIQ_KB;

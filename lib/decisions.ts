import type { Decision } from "./types";

export const DECISIONS: Decision[] = [
  {
    id: "laptop",
    location: "work",
    tag: "Gear",
    emoji: "💻",
    title: "Cracked Laptop",
    prompt:
      "Your laptop screen looks like a spider's diary and it dies if you breathe near it. You need a working machine for school and gigs.",
    options: [
      {
        id: "used",
        label: "Buy a used one (cash)",
        blurb: "Pay $380 now, own it outright.",
        effect: { cash: -380, skill: 4, stress: -3 },
        tone: "good",
        consequence:
          "You drop $380 on a refurb. Wallet lighter, but it's YOURS. No monthly ghost haunting your account.",
        lesson:
          "Paying once hurts once. Financing hurts every month, often for way longer than the thing lasts.",
        timeline: {
          title: "Bought a used laptop",
          description: "Cash purchase. No recurring drain.",
          tone: "good",
        },
      },
      {
        id: "credit",
        label: "Put it on the credit card",
        blurb: "$520 new + interest if you carry it.",
        effect: { cash: -40, debt: 520, credit: -6, stress: 6 },
        tone: "warning",
        consequence:
          "Brand new, zero down — feels free. It is not free. Interest is now quietly farming you in the background.",
        lesson:
          "A credit card delays the pain, it doesn't delete it. Carrying a balance turns a $520 laptop into a $620 laptop.",
        timeline: {
          title: "Financed laptop on credit",
          description: "Balance accrues interest until paid.",
          tone: "warning",
          delay: 2,
        },
      },
      {
        id: "bnpl",
        label: "Buy Now, Pay Later (4 payments)",
        blurb: "'Only $130/mo!' for 4 months.",
        effect: { cash: -10, debt: 520, stress: 8, freedom: -4 },
        tone: "bad",
        consequence:
          "Four tidy payments appear on your calendar like uninvited roommates. Miss one and the fees wake up hungry.",
        lesson:
          "BNPL splits the price, not the risk. Stacked plans quietly become a second rent you never signed up for.",
        timeline: {
          title: "Laptop on BNPL",
          description: "4 scheduled payments locked in.",
          tone: "bad",
          delay: 1,
        },
      },
      {
        id: "wait",
        label: "Tape it and wait",
        blurb: "Limp along, save up first.",
        effect: { stress: 7, skill: -2, freedom: 3 },
        tone: "neutral",
        consequence:
          "You and the spider-screen survive another month. Annoying, but you owe exactly nobody.",
        lesson:
          "Waiting is a real option. 'I'll buy it when I can afford it' is a flex disguised as patience.",
        timeline: {
          title: "Delayed the laptop buy",
          description: "Saving up instead of borrowing.",
          tone: "neutral",
        },
      },
    ],
  },
  {
    id: "trip",
    location: "apartment",
    tag: "Social",
    emoji: "🏝️",
    title: "Friend Trip",
    prompt:
      "The group chat is going feral. Everyone's booking a weekend away. 'It's once in a lifetime' — they said that last month too.",
    options: [
      {
        id: "cash",
        label: "Go, pay in cash",
        blurb: "$300 you actually have.",
        effect: { cash: -300, stress: -10, freedom: 2 },
        tone: "good",
        consequence:
          "You go, you laugh, you pay with money that exists. Sunday-night dread: zero.",
        lesson:
          "Fun you can afford is just fun. Fun you finance is a bill wearing a party hat.",
        timeline: {
          title: "Weekend trip (paid cash)",
          description: "Memory unlocked, no debt added.",
          tone: "good",
        },
      },
      {
        id: "credit",
        label: "Send it on credit",
        blurb: "$300 + future-you's problem.",
        effect: { cash: 0, debt: 300, stress: -6, credit: -3 },
        tone: "warning",
        consequence:
          "Best weekend ever! The statement arrives Tuesday like a hangover with a number on it.",
        lesson:
          "Borrowing for vibes is the fastest way to pay full price twice. The memory fades; the interest doesn't.",
        timeline: {
          title: "Trip financed on credit",
          description: "Vacation now, payment later.",
          tone: "warning",
          delay: 1,
        },
      },
      {
        id: "cheaper",
        label: "Pitch a cheaper plan",
        blurb: "Day trip instead of a hotel.",
        effect: { cash: -80, stress: -6, skill: 3, freedom: 3 },
        tone: "good",
        consequence:
          "You counter with a day trip. Two friends are relieved — they were broke and too proud to say it.",
        lesson:
          "You can keep the friends and skip the financial damage. Being the one who suggests cheaper is a skill, not a downgrade.",
        timeline: {
          title: "Renegotiated the plan",
          description: "Same crew, smaller bill.",
          tone: "good",
        },
      },
      {
        id: "skip",
        label: "Skip it, pick up a shift",
        blurb: "Earn instead of spend.",
        effect: { cash: 140, stress: 8, skill: 2, freedom: -3 },
        tone: "neutral",
        consequence:
          "You stay back and work. The FOMO is real, the bank balance is realer.",
        lesson:
          "Saying no costs social points now and buys options later. Just don't say no to everything — burnout has a bill too.",
        timeline: {
          title: "Skipped trip, worked",
          description: "Traded the weekend for cash.",
          tone: "neutral",
        },
      },
    ],
  },
  {
    id: "guru",
    location: "feed",
    tag: "Scam radar",
    emoji: "🤖",
    title: "AI Trading Bot DM",
    prompt:
      "A blue-check stranger slides in: 'My AI bot does 12% A WEEK. Spots are closing. Just send the starter $250 and watch.'",
    options: [
      {
        id: "join",
        label: "Send the $250",
        blurb: "Lambo loading… allegedly.",
        effect: { cash: -250, stress: 12, freedom: -6 },
        tone: "bad",
        consequence:
          "The dashboard shows green numbers going up. Then withdrawals 'require a $300 unlock fee.' The money is gone.",
        lesson:
          "Guaranteed returns plus urgency equals bait. Real investing is boring; scams are the ones promising fireworks.",
        timeline: {
          title: "Sent money to 'AI bot'",
          description: "Funds unrecoverable. Classic exit scam.",
          tone: "bad",
        },
      },
      {
        id: "ignore",
        label: "Ignore and scroll on",
        blurb: "Leave them on read.",
        effect: { stress: -1, freedom: 1 },
        tone: "neutral",
        consequence:
          "You keep scrolling. Nothing happens, which is exactly the correct amount of things to happen here.",
        lesson:
          "Doing nothing is a legitimate financial move. Not every DM deserves a decision.",
        timeline: {
          title: "Ignored a bot DM",
          description: "No loss, no engagement.",
          tone: "neutral",
        },
      },
      {
        id: "investigate",
        label: "Investigate first",
        blurb: "Reverse-image the 'profits'.",
        effect: { skill: 6, stress: 2, freedom: 3 },
        tone: "good",
        consequence:
          "The 'profit screenshots' are stolen, the testimonials are stock photos, the 'fund' has no registration. Textbook.",
        lesson:
          "Two minutes of searching beats two weeks of regret. Verify the receipts before you become one.",
        timeline: {
          title: "Investigated a scam",
          description: "Spotted the red flags. Skill up.",
          tone: "good",
        },
      },
      {
        id: "report",
        label: "Report the account",
        blurb: "Protect the next victim.",
        effect: { skill: 4, freedom: 4, stress: -2 },
        tone: "good",
        consequence:
          "Reported. Your Scam Radar levels up and somewhere a future victim just got quietly protected.",
        lesson:
          "Reporting scams is free XP. The more you can name the trick, the harder you are to trick.",
        timeline: {
          title: "Reported a scammer",
          description: "Scam radar boosted.",
          tone: "good",
        },
      },
    ],
  },
  {
    id: "card",
    location: "bank",
    tag: "Credit",
    emoji: "💳",
    title: "Beginner Credit Card",
    prompt:
      "Your bank just handed you a tiny plastic sword. It can build your future or stab your credit score. They're calling it 'a starter card.'",
    options: [
      {
        id: "autopay",
        label: "Accept + autopay in full",
        blurb: "Small spend, paid monthly.",
        effect: { credit: 22, skill: 4, freedom: 4 },
        tone: "good",
        consequence:
          "You charge tiny things and auto-pay the whole balance. The bank reports you as 'responsible.' Credit score: climbing.",
        lesson:
          "Credit is trust you can build for free — if you pay in full. Used right, the plastic sword fights for you.",
        timeline: {
          title: "Opened a card, autopay on",
          description: "Building credit the safe way.",
          tone: "good",
        },
      },
      {
        id: "max",
        label: "Accept + max it out",
        blurb: "Treat it like free money.",
        effect: { cash: 900, debt: 900, credit: -30, stress: 10 },
        tone: "bad",
        consequence:
          "New fit, new tech, new everything. Then the utilization hits 95% and your score nosedives off a cliff.",
        lesson:
          "Maxing a card tells lenders you're drowning. High utilization tanks your score and makes every future loan pricier.",
        timeline: {
          title: "Maxed the new card",
          description: "Utilization spiked, score dropped.",
          tone: "bad",
          delay: 1,
        },
      },
      {
        id: "decline",
        label: "Decline it entirely",
        blurb: "No card, no temptation.",
        effect: { stress: -2, credit: -4 },
        tone: "neutral",
        consequence:
          "You walk away clean. Zero risk — but also zero credit history, which future-you will have to start from scratch.",
        lesson:
          "Avoiding credit avoids debt but also avoids building a track record. No history can be its own kind of expensive.",
        timeline: {
          title: "Declined a starter card",
          description: "No debt, no credit-building either.",
          tone: "neutral",
        },
      },
      {
        id: "emergency",
        label: "Accept, emergencies only",
        blurb: "Freeze it in a drawer.",
        effect: { credit: 12, skill: 3, freedom: 2 },
        tone: "good",
        consequence:
          "The card lives in a drawer for true emergencies. Quietly building history, loudly not tempting you.",
        lesson:
          "A card you barely use still builds credit. The trick is treating the limit as a safety net, not a budget.",
        timeline: {
          title: "Card kept for emergencies",
          description: "Low-key credit building.",
          tone: "good",
        },
      },
    ],
  },
  {
    id: "rent",
    location: "apartment",
    tag: "Bills",
    emoji: "🏚️",
    title: "Rent Increase",
    prompt:
      "Landlord email, subject line 'small update :)'. The 'small update' is +$220/month. Your apartment did not get $220 better.",
    options: [
      {
        id: "pay",
        label: "Just pay it",
        blurb: "Absorb the hit, stay put.",
        effect: { cash: -220, stress: 9, freedom: -5 },
        tone: "warning",
        consequence:
          "You eat the increase. Same apartment, less margin, more month at the end of your money.",
        lesson:
          "Housing is usually your biggest lever. Letting it creep up silently shrinks every other choice you get to make.",
        timeline: {
          title: "Absorbed a rent hike",
          description: "Monthly margin got tighter.",
          tone: "warning",
          delay: 1,
        },
      },
      {
        id: "roommate",
        label: "Find a roommate",
        blurb: "Split it, halve the pain.",
        effect: { cash: 180, stress: 4, freedom: 3 },
        tone: "good",
        consequence:
          "You list the spare room. Less privacy, but rent just got cut nearly in half. Math doesn't care about your introversion.",
        lesson:
          "Splitting fixed costs is the cheat code nobody posts about. A roommate can fund more freedom than a raise.",
        timeline: {
          title: "Took on a roommate",
          description: "Halved the biggest fixed cost.",
          tone: "good",
        },
      },
      {
        id: "move",
        label: "Move somewhere cheaper",
        blurb: "Farther out, lower rent.",
        effect: { cash: -150, stress: 14, freedom: 6 },
        tone: "warning",
        consequence:
          "Moving costs money and your soul this month, but next month's rent drops hard. Longer commute, longer runway.",
        lesson:
          "Moving has upfront pain and downstream relief. Just price in the commute — time and gas are rent you pay in disguise.",
        timeline: {
          title: "Moved to cut rent",
          description: "Upfront cost, lower monthly going forward.",
          tone: "neutral",
          delay: 1,
        },
      },
      {
        id: "negotiate",
        label: "Negotiate the increase",
        blurb: "Reply like an adult.",
        effect: { cash: -60, skill: 5, stress: 3, freedom: 2 },
        tone: "good",
        consequence:
          "You reply citing your spotless payment record. Landlord blinks and meets you halfway. The 'small update' got smaller.",
        lesson:
          "Almost everything is negotiable; most people just never ask. A polite email can be worth hundreds.",
        timeline: {
          title: "Negotiated the rent",
          description: "Talked the increase down.",
          tone: "good",
        },
      },
    ],
  },
  {
    id: "subs",
    location: "apartment",
    tag: "Leaks",
    emoji: "🩸",
    title: "Subscription Creep",
    prompt:
      "Bank statement audit: streaming x4, two apps you forgot existed, a gym you've visited once. Your small monthly payments have combined into Rent 2.",
    options: [
      {
        id: "cancel",
        label: "Cancel most of them",
        blurb: "Keep one, kill the rest.",
        effect: { cash: 60, stress: -4, freedom: 4 },
        tone: "good",
        consequence:
          "You cancel four subs in ten minutes. That's $60/month back — a raise you gave yourself for free.",
        lesson:
          "Cancelling a $15 sub is a guaranteed, tax-free return. The best 'investment' is often plugging a leak.",
        timeline: {
          title: "Cancelled dead subscriptions",
          description: "Recovered monthly cash flow.",
          tone: "good",
        },
      },
      {
        id: "ignore",
        label: "Ignore it, too much effort",
        blurb: "They're 'only' small.",
        effect: { cash: -20, stress: 3, freedom: -3 },
        tone: "bad",
        consequence:
          "You close the app. The subscriptions keep nibbling, silent and patient, like very polite financial piranhas.",
        lesson:
          "'It's only $9' is the most expensive sentence in personal finance. Small leaks sink budgets quietly.",
        timeline: {
          title: "Ignored subscription creep",
          description: "Leaks keep draining each month.",
          tone: "bad",
          delay: 2,
        },
      },
      {
        id: "downgrade",
        label: "Downgrade tiers",
        blurb: "Same apps, cheaper plans.",
        effect: { cash: 30, freedom: 2 },
        tone: "good",
        consequence:
          "You drop to the ad-supported and basic tiers. Barely notice the difference, definitely notice the savings.",
        lesson:
          "You rarely need the top tier of anything. Downgrading is invisible to your life and obvious to your balance.",
        timeline: {
          title: "Downgraded subscriptions",
          description: "Trimmed costs without cancelling.",
          tone: "good",
        },
      },
      {
        id: "keep",
        label: "Keep them all, you earned it",
        blurb: "Treat yourself, repeatedly.",
        effect: { cash: -40, stress: -3, freedom: -4 },
        tone: "warning",
        consequence:
          "Everything stays. Comfort intact, cash flow leaking. The 'I earned it' tax is now a standing order.",
        lesson:
          "Convenience has a price, and that's fine — as long as you chose it. Autopilot spending is the only real enemy.",
        timeline: {
          title: "Kept every subscription",
          description: "Comfort now, slimmer margin later.",
          tone: "warning",
          delay: 1,
        },
      },
    ],
  },
  {
    id: "hustle",
    location: "work",
    tag: "Income",
    emoji: "🧾",
    title: "Side Hustle Offer",
    prompt:
      "A client wants a big freelance project. Great rate, glowing vibes — but they 'pay net-60' and have a website that loads in 2008.",
    options: [
      {
        id: "accept",
        label: "Accept, no deposit",
        blurb: "Trust the vibes.",
        effect: { skill: 8, stress: 12, cash: 0, freedom: -3 },
        tone: "warning",
        consequence:
          "You do the work. The invoice ages like milk. 'Payment processing' becomes their favorite phrase.",
        lesson:
          "Doing work isn't the same as getting paid. Cash flow, not the rate, decides whether a gig actually helps you.",
        timeline: {
          title: "Took a net-60 gig",
          description: "Work done, payment delayed.",
          tone: "warning",
          delay: 2,
        },
      },
      {
        id: "deposit",
        label: "Ask for a 50% deposit",
        blurb: "Skin in the game first.",
        effect: { cash: 400, skill: 6, stress: 2, freedom: 4 },
        tone: "good",
        consequence:
          "You ask for half upfront. Serious clients say yes instantly; time-wasters vanish. Either way, you win.",
        lesson:
          "A deposit filters flakes and funds your work. Asking for it isn't rude — it's how professionals get paid.",
        timeline: {
          title: "Got a deposit upfront",
          description: "Cash secured before the work.",
          tone: "good",
        },
      },
      {
        id: "reject",
        label: "Reject it",
        blurb: "Too risky, walk away.",
        effect: { stress: -3, skill: -1, freedom: 1 },
        tone: "neutral",
        consequence:
          "You pass. No payment drama, but also no income and a tiny pang of 'what if.'",
        lesson:
          "Saying no to bad terms protects your time. Just make sure you're rejecting the risk, not the opportunity.",
        timeline: {
          title: "Declined a risky gig",
          description: "Avoided the payment risk.",
          tone: "neutral",
        },
      },
      {
        id: "quick",
        label: "Take a smaller, instant-pay gig",
        blurb: "Less money, paid today.",
        effect: { cash: 160, skill: 3, stress: 4 },
        tone: "good",
        consequence:
          "You grab a smaller gig that pays on delivery. Less glamorous, but the money actually shows up.",
        lesson:
          "A bird in the bank beats two in 'net-60.' Reliable small income often beats a flashy maybe.",
        timeline: {
          title: "Took a fast-pay gig",
          description: "Smaller sum, real cash now.",
          tone: "good",
        },
      },
    ],
  },
  {
    id: "crash",
    location: "market",
    tag: "Markets",
    emoji: "📉",
    title: "Market Crash",
    prompt:
      "Your investments just turned the color of a fire alarm. Down 22% overnight. The timeline is screaming. The market has chosen violence.",
    options: [
      {
        id: "panic",
        label: "Panic sell everything",
        blurb: "Make the red stop.",
        effect: { cash: 600, stress: -4, freedom: -8, skill: -3 },
        tone: "bad",
        consequence:
          "You sell at the bottom and lock the loss in forever. Two weeks later it bounces back without you.",
        lesson:
          "Selling in a panic turns a paper dip into a permanent loss. The market punishes flinching more than waiting.",
        timeline: {
          title: "Panic-sold the dip",
          description: "Locked in losses at the bottom.",
          tone: "bad",
        },
      },
      {
        id: "hold",
        label: "Hold and touch grass",
        blurb: "Do nothing, on purpose.",
        effect: { stress: 6, freedom: 3, skill: 4 },
        tone: "good",
        consequence:
          "You close the app and go outside. The portfolio is still red today — and recovers over the months you didn't watch.",
        lesson:
          "For long-term money, doing nothing during a crash is usually the pro move. Time in beats timing.",
        timeline: {
          title: "Held through a crash",
          description: "Rode out the volatility.",
          tone: "good",
        },
      },
      {
        id: "buy",
        label: "Buy more (only spare cash)",
        blurb: "Stuff's on sale.",
        effect: { cash: -300, freedom: 5, stress: 8, skill: 5 },
        tone: "warning",
        consequence:
          "You buy the dip with money you won't need soon. Risky nerve — but historically, sales don't last forever.",
        lesson:
          "Buying a dip can pay off, but only with money you can leave alone. Never invest cash you need next month.",
        timeline: {
          title: "Bought the dip",
          description: "Added during the crash.",
          tone: "neutral",
        },
      },
      {
        id: "stop",
        label: "Swear off investing forever",
        blurb: "Cash under mattress mode.",
        effect: { stress: -2, freedom: -5, skill: -2 },
        tone: "warning",
        consequence:
          "You vow to never invest again. Safe from crashes — and from growth. Inflation quietly eats the cash you're hiding.",
        lesson:
          "Avoiding all risk has its own cost: inflation. Cash feels safe but slowly loses value while it sits still.",
        timeline: {
          title: "Quit investing entirely",
          description: "Safe from dips, exposed to inflation.",
          tone: "warning",
          delay: 3,
        },
      },
    ],
  },
];

export function decisionsForLocation(location: string | null): Decision[] {
  if (!location) return DECISIONS;
  return DECISIONS.filter((d) => d.location === location);
}

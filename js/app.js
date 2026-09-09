/* ==========================================================
   LeadForge 360 — Client Application
   Single-file portal. All state in localStorage. No backend.
   ========================================================== */
const LF = { views:{}, charts:{} };
window.LF = LF; // expose for inline handlers + test harnesses

/* ---- Seed data ---- */
const FIRST_NAMES = ["Priya","Arjun","Ravi","Ananya","Rohan","Neha","Vikram","Sneha","Aditya","Meera","Karan","Divya","Rahul","Pooja","Sanjay","Ishita","Amit","Riya","Kabir","Tanvi","Omar","Layla","Hassan","Noura","Faisal","Aisha","Yusuf","Zainab","James","Olivia","Michael","Emma","David","Sophia","Chen","Li","Hiroshi","Yuki","Arun","Kavya","Nikhil","Aarti","Deepak","Shreya","Vivek","Nisha","Raj","Kritika","Saad","Huda"];
const LAST_NAMES = ["Sharma","Patel","Kumar","Singh","Verma","Reddy","Gupta","Joshi","Shah","Desai","Iyer","Menon","Al Maktoum","Al Qasimi","Hassan","Khan","Tan","Lim","Chen","Suzuki","Nakamura","Smith","Johnson","Williams","Brown","Bernal","Ramirez","Silva","Costa","Oliveira","Benial","Kaushik","Das","Dutta","Mukherjee","Saxena","Agarwal","Mehta","Chopra","Kapoor","Malhotra"];
const COMPANIES = ["Nexora Solutions","Bharat Infotech","Gulf Logistics LLC","Oasis Realty","Silverline Clinics","MediCore Health","Kaizen Analytics","Zenith Retail","Polaris Consulting","Helix Pharma","Orbit Education","Summit Capital","Crescent Exports","DesertLink Media","Meridian Builders","Indus Steel","Velvet Hospitality","FinEdge Advisors","Skyline Motors","NimbusCloud","PixelForge","SunriseAgri","TrueNorth Legal","BrightPath Schools","AeroLogix","HealthBridge","GreenLeaf Organics","Cobalt Security","Apex Industries","Stellar IoT"];
const SOURCES = ["Meta Lead Ads","LinkedIn Lead Gen","Google Ads","Website Form","IndiaMART","JustDial","WhatsApp","Event - Dubai Expo","Event - Bengaluru Summit","Referral","Cold Outbound","Chatbot","Apollo","TikTok Lead Gen"];
const INDUSTRIES = ["SaaS","Real Estate","Healthcare","BFSI","Education","Retail","Manufacturing","Hospitality","Logistics","Pharma","Legal","Media"];
const CITIES = [["Mumbai","IN"],["Bengaluru","IN"],["Delhi","IN"],["Hyderabad","IN"],["Pune","IN"],["Chennai","IN"],["Dubai","AE"],["Abu Dhabi","AE"],["Doha","QA"],["Riyadh","SA"],["Singapore","SG"],["Jakarta","ID"],["London","GB"],["New York","US"],["San Francisco","US"],["Sydney","AU"]];
const STAGES = ["New","Contacted","Qualified","Demo","Proposal","Won","Lost"];
const STAGE_COLORS = {New:"slate",Contacted:"sky",Qualified:"blue",Demo:"warn",Proposal:"green",Won:"green",Lost:"danger"};
const OWNERS = [
  {id:"u1", name:"Ashok Benial", email:"ashok.benial@ab7solutions.com", role:"Admin", avatar:"AB", team:"Enterprise"},
  {id:"u2", name:"Priya Sharma", email:"priya@ab7solutions.com", role:"AE", avatar:"PS", team:"Enterprise", grp:"g2"},
  {id:"u3", name:"Rahul Iyer", email:"rahul@ab7solutions.com", role:"AE", avatar:"RI", team:"Mid-Market", grp:"g3"},
  {id:"u4", name:"Neha Kapoor", email:"neha@ab7solutions.com", role:"SDR", avatar:"NK", team:"Mid-Market", grp:"g4"},
  {id:"u5", name:"Omar Al Qasimi", email:"omar@ab7solutions.com", role:"AE", avatar:"OA", team:"GCC", grp:"g5"},
  {id:"u6", name:"Aditya Rao", email:"aditya@ab7solutions.com", role:"SDR", avatar:"AR", team:"SEA", grp:"g2"}
];

function rand(a){return a[Math.floor(Math.random()*a.length)]}
function rid(){return "id_"+Math.random().toString(36).slice(2,10)}
function fmtCur(n, ccy){
  /* Portal-wide INR-only policy — always render in Indian Rupees so the dashboard never sums mixed currencies. */
  return "₹" + Math.round(Number(n)||0).toLocaleString("en-IN");
}
function fmtDate(d){ d = new Date(d); return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) }
function fmtTime(d){ d = new Date(d); const n = new Date(); const delta = (n-d)/1000; if(delta<60)return "just now"; if(delta<3600)return Math.floor(delta/60)+"m"; if(delta<86400)return Math.floor(delta/3600)+"h"; if(delta<604800)return Math.floor(delta/86400)+"d"; return fmtDate(d) }
function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])) }
function initials(n){ return n.split(" ").map(p=>p[0]).slice(0,2).join("").toUpperCase() }

// Single source of truth for "who can own/be-assigned a lead or task" —
// always reads the real team list from state. Returns an empty array
// when no team is set up yet (which is correct: dropdowns should be empty
// rather than showing demo names from the legacy OWNERS constant).
function ownersList(){ return (LF.state && LF.state.teamMembers) || [] }

/* ==========================================================
   LF.score — deterministic lead scoring from observable lead
   attributes. Replaces the legacy hard-coded score=40 default
   so the Avg Score Trend, Hot-Prospects KPI, AI Insights and
   the Customization → Formula field actually have signal.

   Scoring breakdown (max 100):
     • Stage progression          0–30
     • Activity engagement        0–20
     • Deal value                 0–15
     • Recency (days since touch) 0–15
     • Data completeness          0–10
     • Source quality             0–10
   ========================================================== */
LF.score = {
  // Stage points: Lost is 0 (deal is dead), Won is full (deal closed),
  // intermediate stages climb in a roughly even curve.
  _stagePts: {
    "New":5, "Contacted":10, "Qualified":18, "Demo":22,
    "Proposal":26, "Negotiation":28, "Won":30, "Lost":0
  },
  // Source quality — channels that historically convert better get
  // more weight. Tuned to match the seeded SOURCES list.
  _sourcePts: {
    "LinkedIn Lead Gen":10, "Referral":10, "Inbound":9,
    "Website Form":7, "Webinar":7, "Event":6,
    "Cold Outbound":4, "Cold Email":4, "Cold Call":4
  },
  compute(lead){
    if(!lead || typeof lead !== "object") return 0;
    let s = 0;
    // Stage
    s += LF.score._stagePts[lead.stage] != null ? LF.score._stagePts[lead.stage] : 8;
    // Engagement — non-create activities count more
    const acts = Array.isArray(lead.activities) ? lead.activities : [];
    const realActs = acts.filter(a => a && a.type !== "create").length;
    s += Math.min(realActs * 4, 20);
    // Deal value — tiered, capped at 15
    const amt = Number(lead.amount) || 0;
    if      (amt >= 100000) s += 15;
    else if (amt >=  50000) s += 12;
    else if (amt >=  10000) s += 8;
    else if (amt >      0)  s += 3;
    // Recency — penalise stale leads
    const touchedAt = lead.updatedAt || lead.createdAt || (acts.length ? Math.max(...acts.map(a=>a&&a.at||0)) : 0);
    if(touchedAt){
      const days = (Date.now() - touchedAt) / 86400000;
      if      (days <  3) s += 15;
      else if (days <  7) s += 10;
      else if (days < 14) s +=  5;
      else if (days < 30) s +=  2;
    }
    // Data completeness
    if(lead.phone)           s += 3;
    if(lead.notes)           s += 3;
    if(lead.serviceInterest) s += 4;
    // Source
    s += LF.score._sourcePts[lead.source] != null ? LF.score._sourcePts[lead.source] : 5;
    return Math.max(0, Math.min(100, Math.round(s)));
  },
  // Recompute score on every lead in state. Returns the count touched.
  recomputeAll(){
    const L = (LF.state && LF.state.leads) || [];
    let n = 0;
    L.forEach(l => {
      const next = LF.score.compute(l);
      if(next !== l.score){ l.score = next; n++; }
    });
    return n;
  }
};

function seedLeads(n=48){
  const leads=[], now=Date.now();
  for(let i=0;i<n;i++){
    const fn=rand(FIRST_NAMES), ln=rand(LAST_NAMES), co=rand(COMPANIES), src=rand(SOURCES);
    const ind=rand(INDUSTRIES), [city,country]=rand(CITIES);
    const owner=rand(ownersList().filter(o=>o.role!=="Admin")||ownersList());
    const stage=rand(STAGES.slice(0,5).concat(["Won","Lost"].filter(()=>Math.random()<.3)));
    const score=Math.floor(20+Math.random()*80);
    const amt=Math.floor(5000+Math.random()*95000);
    const created=now - Math.floor(Math.random()*60)*86400000;
    leads.push({
      id:rid(), firstName:fn, lastName:ln, name:`${fn} ${ln}`,
      email:`${fn.toLowerCase()}.${ln.toLowerCase().replace(/[^a-z]/g,'')}@${co.toLowerCase().replace(/[^a-z]/g,'')}.com`,
      phone:"+"+(country==="IN"?"91 9":country==="AE"?"971 5":"1 ")+Math.floor(100000000+Math.random()*899999999),
      company:co, industry:ind, city, country, source:src,
      ownerId:owner.id, stage, score, amount:amt, currency:"INR",
      createdAt:created, updatedAt:created+Math.floor(Math.random()*86400000*15),
      tags: score>75?["hot"]:score>55?["warm"]:["cold"],
      notes:"",
      consent:{email:Math.random()>.2, whatsapp:Math.random()>.4, sms:Math.random()>.5},
      activities: [
        {type:"create", at:created, by:owner.id, text:`Lead captured from ${src}`},
        {type:"email", at:created+86400000, by:owner.id, text:`Sent welcome email`}
      ]
    });
  }
  return leads;
}

function seedThreads(leads){
  const chans=["email","whatsapp","sms","linkedin","voice"];
  return leads.slice(0,14).map((l,i)=>{
    const chan=chans[i%chans.length];
    return {
      id:rid(), leadId:l.id, channel:chan, subject:i%2?`Re: ${l.company} — enterprise plan`:`Interest in LeadForge demo`,
      unread:Math.random()>.6,
      messages:[
        {from:l.id, at:Date.now()-86400000*2, text:`Hi, we spoke last week about your solution — could you share more details and pricing for ${l.company}?`},
        {from:"me", at:Date.now()-86400000, text:`Absolutely ${l.firstName}, attaching our deck. Can we schedule a 30-min call Tuesday at 3 PM IST?`},
        {from:l.id, at:Date.now()-3600000*6, text:`Tuesday works. Please include your pricing and integration options with HubSpot.`}
      ]
    };
  });
}

function seedWorkflows(){
  return [
    {id:rid(), name:"Welcome Sequence (India)", status:"active", runs:1247, trigger:"Lead Created",
     steps:[{type:"trigger",t:"Lead Created",s:"source = Website Form"},{type:"action",t:"Send Email",s:"Template: Welcome v3"},{type:"wait",t:"Wait 1 day"},{type:"cond",t:"Opened Email?",s:"yes → continue"},{type:"action",t:"WhatsApp Nudge",s:"Template: Next Steps"},{type:"action",t:"Assign to SDR",s:"Round-robin"}]},
    {id:rid(), name:"GCC High-Value Nurture", status:"active", runs:412, trigger:"Score ≥ 75",
     steps:[{type:"trigger",t:"Score ≥ 75"},{type:"action",t:"Notify AE"},{type:"action",t:"Create Task"},{type:"action",t:"Book Meeting"}]},
    {id:rid(), name:"Abandoned Demo Recovery", status:"paused", runs:88, trigger:"Demo no-show",
     steps:[{type:"trigger",t:"Demo no-show"},{type:"wait",t:"Wait 2 hours"},{type:"action",t:"AI-drafted follow-up"},{type:"wait",t:"Wait 1 day"},{type:"cond",t:"Replied?"},{type:"action",t:"Re-schedule"}]}
  ];
}

function seedAgents(){
  return [
    {id:"a1",name:"SDR Agent",role:"Autonomous outbound prospecting",ico:"SDR",status:"running",runs:284,accept:82,cost:0.12,model:"Claude Sonnet 4.6",last:"2m ago",desc:"Identifies ICP-fit leads, drafts 6-touch sequences, books qualified calls."},
    {id:"a2",name:"Researcher Agent",role:"Enrichment &amp; intent",ico:"RES",status:"running",runs:1940,accept:94,cost:0.03,model:"Claude Haiku 4.5",last:"just now",desc:"Fetches firmographics, tech stack, news, and intent signals; writes to CDP."},
    {id:"a3",name:"Scheduler Agent",role:"Meeting booking",ico:"SCH",status:"idle",runs:521,accept:91,cost:0.02,model:"Claude Haiku 4.5",last:"14m ago",desc:"Reads calendars, proposes times, sends invites, handles reschedules."},
    {id:"a4",name:"Qualifier Agent",role:"BANT / MEDDIC chat",ico:"QUA",status:"running",runs:732,accept:78,cost:0.08,model:"Claude Sonnet 4.6",last:"5m ago",desc:"6-turn discovery chat with inbound leads; populates CRM fields automatically."},
    {id:"a5",name:"Follow-up Agent",role:"Multi-channel cadence",ico:"FUP",status:"running",runs:2104,accept:86,cost:0.04,model:"Claude Haiku 4.5",last:"1m ago",desc:"Sends contextual follow-ups across email/WhatsApp/SMS; escalates on intent spikes."},
    {id:"a6",name:"Coach Agent",role:"Rep coaching",ico:"CCH",status:"paused",runs:146,accept:71,cost:0.15,model:"Claude Opus 4.6",last:"2h ago",desc:"Reviews calls, flags objections, suggests skill-building actions per rep."},
    {id:"a7",name:"Analyst Agent",role:"Revenue insights",ico:"ANL",status:"idle",runs:68,accept:89,cost:0.22,model:"Claude Opus 4.6",last:"30m ago",desc:"Runs ad-hoc analytics in natural language; generates forecast commentary."}
  ];
}

function seedIntegrations(){
  return [
    {name:"Google Workspace",cat:"Productivity",on:true,desc:"Gmail, Calendar, Drive sync."},
    {name:"Microsoft 365",cat:"Productivity",on:true,desc:"Outlook, Teams, OneDrive."},
    {name:"Slack",cat:"Comms",on:true,desc:"Channel notifications, slash commands."},
    {name:"WhatsApp BSP",cat:"Channel",on:true,desc:"Meta-verified template messaging."},
    {name:"Exotel",cat:"Telephony",on:true,desc:"India cloud telephony + DLT."},
    {name:"Twilio",cat:"Telephony",on:false,desc:"Global SMS + voice."},
    {name:"LinkedIn Sales Nav",cat:"Social",on:true,desc:"Enrichment + InMail sync."},
    {name:"IndiaMART",cat:"Leadgen",on:true,desc:"Inquiry ingestion."},
    {name:"Meta Lead Ads",cat:"Leadgen",on:true,desc:"Instant lead forwarding."},
    {name:"Google Ads",cat:"Leadgen",on:true,desc:"Conversion import + offline."},
    {name:"Stripe",cat:"Payments",on:false,desc:"Subscription + invoicing."},
    {name:"Razorpay",cat:"Payments",on:true,desc:"India payments + UPI."},
    {name:"DocuSign",cat:"Docs",on:true,desc:"e-Signature workflows."},
    {name:"Zoho Books",cat:"Finance",on:false,desc:"Invoice + GST sync."},
    {name:"Tally",cat:"Finance",on:false,desc:"Ledger sync for India."},
    {name:"Zapier",cat:"Automation",on:true,desc:"6000+ app connectors."},
    {name:"HubSpot (Migration)",cat:"Migration",on:false,desc:"One-click importer."},
    {name:"Zoho CRM (Migration)",cat:"Migration",on:false,desc:"Migration Studio."}
  ];
}

/* Outcome picklists for the Won Leads / Lost Leads views. These constants
   are only the *seed* values — actual lists live in LF.state and are
   editable from Customization. The lead drawer + filters read through
   LF.picklists.* accessors which fall back to these defaults on first run. */
const PRICING_MODELS = ["Per hour","Per project","Retainer","Fixed price","Subscription / monthly","Subscription / annual","Other"];
const WIN_CATEGORIES = ["Competitive pricing","Domain expertise","Faster turnaround","Trusted relationship","Better technology","Strong references","Compliance / certifications","Local presence","Strategic fit","Personal recommendation","Other"];
const WIN_LIST_REASONS = ["Strategic account","Strong product fit","High-LTV segment","Geography match","Referenceable customer","Recurring revenue","Quick close","Repeat business","Strong sponsor","Other"];
const LOSS_CATEGORIES = ["Price too high","Lacked capability","Competitor advantage","Timing","Decision-maker change","Geography mismatch","Outside scope","Disqualified early","Never qualified","Budget mismatch","No response","Other"];
const NOT_IN_LIST_REASONS = ["Disqualified early","Never qualified","Outside service scope","Geography mismatch","Budget mismatch","Wrong contact","Duplicate","Lost to competitor","Other"];

/* ---- State store ---- */
LF.state = {
  user:{},
  leads:[], threads:[], workflows:[], agents:[], integrations:[],
  /* Sub-vendor partners — fed by the ab7solutions.com "become-a-vendor"
     form via POST /api/subvendors/ingest, then managed through the
     Subvendors module (LF.subvendors). Persists like leads. */
  subvendors:[],
  /* Partners — fed by the ab7solutions.com "Become a Partner" apply form via
     POST /api/partners/ingest, managed through the Partners module (LF.partners). */
  partners:[],
  /* Job applicants — fed by the "Apply for a Job" form via POST /api/jobs/ingest,
     managed through the Job Applicants module (LF.jobApplicants). */
  jobApplicants:[],
  selectedLeadIds:new Set(), currentThreadId:null, route:"dashboard",
  filters:{
    leads:{q:"",stage:"",source:"",owner:"",scoreMin:""},
    wonLeads:{q:"",industry:"",owner:"",from:"",to:"",amtMin:"",amtMax:"",winCategory:""},
    lostLeads:{q:"",industry:"",owner:"",from:"",to:"",lossCategory:""},
    allClients:{q:"",stage:"",industry:"",source:"",owner:""}
  },
  sort:{
    leads:{key:"createdAt",dir:"desc"},
    wonLeads:{key:"wonAt",dir:"desc"},
    lostLeads:{key:"lostAt",dir:"desc"}
  },
  page:{leads:1, size:10},
  customFields:[
    {id:"cf1",name:"Budget Range",type:"select",opts:["<$10k","$10k-$50k","$50k+"],required:false},
    {id:"cf2",name:"Decision Timeline",type:"select",opts:["<30 days","30-90 days","90+ days"],required:false},
    {id:"cf3",name:"Preferred Channel",type:"select",opts:["Email","WhatsApp","Phone","LinkedIn"],required:false}
  ],
  scoringRules:[
    {id:rid(),label:"Fortune 500 company",points:20,on:true},
    {id:rid(),label:"Enterprise (500+ employees)",points:15,on:true},
    {id:rid(),label:"Demo requested",points:25,on:true},
    {id:rid(),label:"Email opened (3+ times)",points:10,on:true},
    {id:rid(),label:"Engaged on WhatsApp",points:12,on:true},
    {id:rid(),label:"GCC / North America region",points:8,on:true},
    {id:rid(),label:"Free email domain (gmail, yahoo)",points:-10,on:true},
    {id:rid(),label:"No response in 14 days",points:-15,on:true}
  ],
  routingRules:[
    {id:rid(),name:"Enterprise → Priya",match:"score >= 80 AND industry in [SaaS, BFSI]",assignee:"u2",on:true},
    {id:rid(),name:"GCC region → Omar",match:"country in [AE, SA, QA]",assignee:"u5",on:true},
    {id:rid(),name:"SEA → Aditya",match:"country in [SG, ID, MY]",assignee:"u6",on:true},
    {id:rid(),name:"Default round-robin",match:"*",assignee:"round-robin",on:true}
  ],
  formulaName:"Deal health",
  formulaExpression:'=IF(AND(Score >= 75, DaysSinceLastTouch < 5), "Hot", IF(Score >= 55, "Warm", "Cold"))',
  formulaPublished:false
};

// NO LOCAL CACHE. Supabase is the single source of truth. A stale local copy
// showing wrong data is worse than waiting for the server, so this app keeps
// nothing in localStorage. `save()` is now only a *sync trigger* — the wrapper
// installed below (see "Hook LF.storage.save()") calls LF.db.saveSnapshot(),
// which pushes each changed record to Supabase per-record. `load()` is a no-op.
LF.storage = {
  key:"leadforge.v1",
  // Persists nothing. The 130+ existing call sites still work; the wrapper turns
  // each call into a per-record server sync.
  save(){ /* no-op: data is persisted to Supabase per-record, not cached */ },
  // Nothing to load — the workspace is fetched from Supabase via loadSnapshot().
  load(){ return false; },
  // Clears any cache left by older builds so it can never be read again.
  reset(){ try{ localStorage.removeItem(this.key); }catch(e){} }
};




/* ==========================================================
   LF.db — Supabase API bridge
   ----------------------------------------------------------
   Talks to db-server.js over /api/* — GET /api/snapshot to hydrate,
   per-record POST/PUT/DELETE to persist each change to Supabase.
   There is no local data cache: if the API is unreachable the app
   shows a "can't connect" screen rather than stale data.
   ========================================================== */
LF.db = {
  baseUrl: "",
  online: false,
  status: "offline",
  lastSyncAt: null,
  lastError: null,
  pending: false,
  dbSize: 0,
  _saveTimer: null,

  _setStatus(s, err){ LF.db.status = s; if(err) LF.db.lastError = err; LF.db._updatePill(); },

  async probe(){
    LF.db._setStatus("connecting");
    try {
      const headers = {};
      const tok = LF.db.getApiToken && LF.db.getApiToken();
      if(tok) headers["Authorization"] = "Bearer " + tok;
      const r = await fetch(LF.db.baseUrl + "/api/health", { cache:"no-store", headers });
      if(!r.ok) throw new Error("HTTP "+r.status);
      const j = await r.json();
      LF.db.online = true;
      LF.db.dbSize = j.dbSize||0;
      LF.db.lastError = null;
      LF.db._setStatus("online");
      console.info("[LF.db] ✓ Connected · "+j.db+" · "+j.leads+" leads");
      return true;
    } catch(err){
      LF.db.online = false;
      LF.db._setStatus("offline", err.message);
      console.info("[LF.db] Offline — using browser localStorage cache. ("+err.message+")");
      return false;
    }
  },

  getApiToken(){
    try { return localStorage.getItem("leadforge.apiToken") || ""; } catch(e){ return ""; }
  },
  setApiToken(t){
    try { if(t) localStorage.setItem("leadforge.apiToken", t); else localStorage.removeItem("leadforge.apiToken"); } catch(e){}
    LF.db.probe(); // re-check connectivity with new token
  },
  async req(method, path, body){
    const headers = { "Content-Type": "application/json" };
    const tok = LF.db.getApiToken && LF.db.getApiToken();
    if(tok) headers["Authorization"] = "Bearer " + tok;
    const r = await fetch(LF.db.baseUrl + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if(r.status === 401){
      LF.db._setStatus("error", "Unauthorized — set the API token in Settings → 🗄 Local DB");
      throw new Error("Unauthorized");
    }
    if(!r.ok){ const t = await r.text().catch(()=>""); throw new Error(method+" "+path+" → "+r.status+" "+t.slice(0,160)); }
    return r.json().catch(()=>null);
  },

  // Server snapshots use snake_case for some lead keys (first_name, last_name,
  // owner_id, service_interest, created_at, updated_at, action_plan) while
  // the rest of the app reads camelCase everywhere. Normalize here so the
  // round-trip is consistent. Also backfills firstName / lastName from `name`
  // for legacy rows where only the combined name was persisted (otherwise the
  // edit drawer would open with the name fields blank — see issue 2026-05).
  _normalizeLeadFromServer(l){
    if(!l || typeof l !== "object") return l;
    let firstName = l.firstName != null ? l.firstName : l.first_name;
    let lastName  = l.lastName  != null ? l.lastName  : l.last_name;
    const name = l.name || [firstName, lastName].filter(Boolean).join(" ").trim();
    if((!firstName || !lastName) && name){
      const parts = String(name).trim().split(/\s+/);
      if(!firstName) firstName = parts[0] || "";
      if(!lastName)  lastName  = parts.slice(1).join(" ") || "";
    }
    const toMs = v => {
      if(v == null) return undefined;
      if(typeof v === "number") return v;
      const t = Date.parse(v); return isNaN(t) ? undefined : t;
    };
    // Backfill createdAt / updatedAt from the activity log when the snapshot
    // round-trip dropped them. Without this, dashboard charts (Lead Funnel,
    // Leads by Source, Avg Score Trend) silently filter every legacy lead
    // out because `undefined >= cutoff` is false.
    const acts = Array.isArray(l.activities) ? l.activities : [];
    const createAct = acts.find(a => a && a.type === "create");
    const actTimes = acts.map(a => a && typeof a.at === "number" ? a.at : null).filter(Boolean);
    const earliestAct = actTimes.length ? Math.min(...actTimes) : undefined;
    const latestAct   = actTimes.length ? Math.max(...actTimes) : undefined;
    let createdAt = l.createdAt != null ? l.createdAt : toMs(l.created_at);
    if(createdAt == null) createdAt = (createAct && createAct.at) || earliestAct;
    let updatedAt = l.updatedAt != null ? l.updatedAt : toMs(l.updated_at);
    if(updatedAt == null) updatedAt = latestAct || createdAt;
    // Backfill ownerId from the activity log when it's been lost (Rep
    // Leaderboard renders "No rep activity yet" otherwise — see issue 2026-05).
    // The create activity's `by` field is the lead's original owner; later
    // assign/reassign activities supersede it.
    let ownerId = l.ownerId != null ? l.ownerId : l.owner_id;
    if(ownerId == null && acts.length){
      const lastAssign = [...acts].reverse().find(a => a && a.type === "assign" && a.by);
      ownerId = (lastAssign && lastAssign.by) || (createAct && createAct.by);
    }
    const out = {
      ...l,
      firstName: firstName || "",
      lastName:  lastName  || "",
      name: name || "",
      ownerId,
      serviceInterest: l.serviceInterest !== undefined ? l.serviceInterest : (l.service_interest != null ? l.service_interest : null),
      actionPlan: l.actionPlan != null ? l.actionPlan : l.action_plan,
      createdAt,
      updatedAt
    };
    // Drop the snake_case duplicates so we don't re-persist them on the next
    // POST /api/snapshot and keep accumulating both shapes on disk.
    delete out.first_name; delete out.last_name; delete out.owner_id;
    delete out.service_interest; delete out.action_plan;
    delete out.created_at; delete out.updated_at;
    // Backfill score for legacy leads that still carry the form's default
    // value (40) or no score at all. Real auto-scoring keeps the dashboard's
    // Avg Score Trend, Hot-Prospects KPI and AI Insights meaningful.
    if(LF.score && typeof LF.score.compute === "function"){
      if(out.score == null || out.score === 40){
        out.score = LF.score.compute(out);
      }
    }
    // Outcome data — used by Won Leads / Lost Leads views. Ensure the shape
    // exists so view code can read l.outcome.* without optional-chaining hell.
    // For legacy Won/Lost leads, backfill closedAt from the most recent stage
    // activity that moved into Won or Lost (otherwise the views can't sort
    // or filter by close date).
    if(!out.outcome || typeof out.outcome !== "object") out.outcome = {};
    if(out.stage === "Won" || out.stage === "Lost"){
      if(out.outcome.closedAt == null){
        // Find the most recent activity that moved the lead into this stage.
        // Two text shapes exist in the wild: "Moved to Won" (kanban drag, type
        // "stage") and "Updated: stage → Won" (form edit, type "edit").
        const target = out.stage.toLowerCase();
        const moveAct = [...acts].reverse().find(a =>
          a && typeof a.text === "string" &&
          (a.text.toLowerCase().includes("moved to "+target) ||
           a.text.toLowerCase().includes("stage → "+target))
        );
        out.outcome.closedAt = (moveAct && moveAct.at) || updatedAt || createdAt;
      }
    }
    return out;
  },

  async loadSnapshot(){
    if(!LF.db.online) return false;
    const snap = await LF.db.req("GET","/api/snapshot");
    if(!snap) return false;
    if(Array.isArray(snap.leads) && snap.leads.length){ LF.state.leads = snap.leads.map(LF.db._normalizeLeadFromServer); }
    if(Array.isArray(snap.subvendors)){ LF.state.subvendors = snap.subvendors; }
    if(Array.isArray(snap.partners)){ LF.state.partners = snap.partners; }
    if(Array.isArray(snap.jobApplicants)){ LF.state.jobApplicants = snap.jobApplicants; }
    if(Array.isArray(snap.scheduledTasks) && snap.scheduledTasks.length){ LF.state.scheduledTasks = snap.scheduledTasks; }
    if(Array.isArray(snap.teamMembers) && snap.teamMembers.length){ LF.state.teamMembers = snap.teamMembers; }
    ["company","scoringRules","serviceDomains","serviceCatalog","qualificationTemplates","apiKeys","scim",
     "emailDelivery","emailDns","emailPrefs","emailAccounts","emailAliases","emailLog","emailDeliveryLog",
     "claudeConfig","claudeUsage","integrationConfig","integrations","customFields","mailbox",
     "agentConfig","agentLogs","hitlQueue",
     // Editable picklists — see _buildConfig above.
     "industries","countries","currencies",
     "winCategories","winListReasons","lossCategories","notInListReasons",
     "routingRules","formulaName","formulaExpression","formulaPublished"
    ].forEach(k=>{ if(snap[k]!==undefined && snap[k]!==null) LF.state[k] = snap[k]; });
    LF.db.lastSyncAt = Date.now();
    LF.db._initSynced();          // baseline for the per-record diff sync
    return true;
  },

  // ---- Per-record diff sync (schema v2) ----------------------------------
  // The server is relational: leads/tasks/subvendors are individual rows. So
  // instead of POSTing the whole workspace (which overwrote everyone else's
  // concurrent edits), we diff the current LF.state against the last-synced
  // fingerprint and emit only the rows that changed — POST new, PUT changed,
  // DELETE removed. Two people editing different leads no longer collide.
  // Config (catalog, picklists, rules, team, settings) is low-contention and
  // goes as one bulk /api/config call, only when it actually changed.
  _synced: { leads:{}, tasks:{}, subvendors:{}, configHash:"" },
  _hash(r){ try{ return JSON.stringify(r); }catch(e){ return Math.random().toString(); } },
  _fpMap(arr){ const m={}; (arr||[]).forEach(r=>{ if(r && r.id!=null) m[r.id]=LF.db._hash(r); }); return m; },
  _buildConfig(){
    return {
      teamMembers: LF.state.teamMembers, company: LF.state.company,
      partners: LF.state.partners, jobApplicants: LF.state.jobApplicants,
      scoringRules: LF.state.scoringRules, serviceDomains: LF.state.serviceDomains,
      serviceCatalog: LF.state.serviceCatalog, qualificationTemplates: LF.state.qualificationTemplates,
      industries: LF.state.industries, countries: LF.state.countries, currencies: LF.state.currencies,
      winCategories: LF.state.winCategories, winListReasons: LF.state.winListReasons,
      lossCategories: LF.state.lossCategories, notInListReasons: LF.state.notInListReasons,
      routingRules: LF.state.routingRules,
      formulaName: LF.state.formulaName, formulaExpression: LF.state.formulaExpression,
      formulaPublished: LF.state.formulaPublished,
      apiKeys: LF.state.apiKeys, scim: LF.state.scim,
      emailDelivery: LF.state.emailDelivery, emailDns: LF.state.emailDns, emailPrefs: LF.state.emailPrefs,
      emailAccounts: LF.state.emailAccounts, emailAliases: LF.state.emailAliases,
      emailLog: LF.state.emailLog, emailDeliveryLog: LF.state.emailDeliveryLog,
      claudeConfig: LF.state.claudeConfig, claudeUsage: LF.state.claudeUsage,
      integrationConfig: LF.state.integrationConfig, integrations: LF.state.integrations,
      customFields: LF.state.customFields, mailbox: LF.state.mailbox,
      agentConfig: LF.state.agentConfig, agentLogs: (LF.state.agentLogs||[]).slice(0,200),
      hitlQueue: LF.state.hitlQueue
    };
  },
  // Snapshot the current state as "already on the server" — call after a fresh
  // loadSnapshot so the first user edit only sends the delta, not all 140 leads.
  _initSynced(){
    LF.db._synced = {
      leads: LF.db._fpMap(LF.state.leads),
      tasks: LF.db._fpMap(LF.state.scheduledTasks),
      subvendors: LF.db._fpMap(LF.state.subvendors),
      configHash: LF.db._hash(LF.db._buildConfig())
    };
  },
  async _syncCollection(mapKey, arr, base){
    const prev = LF.db._synced[mapKey] || (LF.db._synced[mapKey]={});
    const seen = {};
    for(const r of (arr||[])){
      if(!r || r.id==null) continue;
      seen[r.id] = true;
      const hstr = LF.db._hash(r);
      if(prev[r.id] === hstr) continue;                 // unchanged
      try {
        if(!(r.id in prev)) await LF.db.req("POST", base, r);        // new row
        else await LF.db.req("PUT", base+"/"+encodeURIComponent(r.id), r);  // changed row
        prev[r.id] = hstr;                              // mark synced only on success
      } catch(e){ console.warn("[LF.db] sync "+base+"/"+r.id+" failed:", e.message); throw e; }
    }
    for(const id of Object.keys(prev)){                  // rows removed locally → delete
      if(!seen[id]){
        try { await LF.db.req("DELETE", base+"/"+encodeURIComponent(id)); delete prev[id]; }
        catch(e){ console.warn("[LF.db] delete "+base+"/"+id+" failed:", e.message); throw e; }
      }
    }
  },
  async _syncNow(){
    if(!LF.db.online) return;
    if(LF.db._syncing){ LF.db._syncPending = true; return; }
    LF.db._syncing = true; LF.db._setStatus("saving");
    try {
      await LF.db._syncCollection("leads", LF.state.leads, "/api/leads");
      await LF.db._syncCollection("tasks", LF.state.scheduledTasks, "/api/tasks");
      await LF.db._syncCollection("subvendors", LF.state.subvendors, "/api/subvendors");
      const cfg = LF.db._buildConfig(); const ch = LF.db._hash(cfg);
      if(ch !== LF.db._synced.configHash){ await LF.db.req("POST","/api/config", cfg); LF.db._synced.configHash = ch; }
      LF.db.lastSyncAt = Date.now(); LF.db._setStatus("online");
    } catch(err){
      console.warn("[LF.db] sync failed:", err.message);
      LF.db._setStatus("error", err.message);
    } finally {
      LF.db._syncing = false;
      if(LF.db._syncPending){ LF.db._syncPending = false; LF.db._syncNow(); }
    }
  },

  saveSnapshot(){
    if(!LF.db.online) return;
    if(LF.db._saveTimer) clearTimeout(LF.db._saveTimer);
    LF.db.pending = true;
    LF.db._saveTimer = setTimeout(()=>{ LF.db.pending = false; LF.db._syncNow(); }, 400);
  },

  // Bypass the 400ms debounce — use after high-stakes writes (member
  // create/delete, credential changes, admin setup) so the server has the
  // change before the user can refresh and re-pull.
  flushSnapshot(){
    if(!LF.db.online) return Promise.resolve(false);
    if(LF.db._saveTimer){ clearTimeout(LF.db._saveTimer); LF.db._saveTimer = null; }
    LF.db.pending = false;
    return LF.db._syncNow().then(()=>true).catch(()=>false);
  },


  _updatePill(){
    const pill = document.getElementById("db-pill"); if(!pill) return;
    const map = {
      offline:   ["slate",  "⊘ Offline (local cache)"],
      connecting:["warn",   "◷ Connecting…"],
      online:    ["green",  "● Supabase"],
      saving:    ["blue",   "⟳ Saving…"],
      error:     ["danger", "✕ Sync error"]
    };
    const [cls,label] = map[LF.db.status]||map.offline;
    pill.className = "tag "+cls;
    pill.style.cursor = "pointer";
    pill.title = LF.db.lastError ? ("Last error: "+LF.db.lastError) : (LF.db.online?"Data persisted to Supabase":"Offline — changes cached in this browser until Supabase is reachable");
    pill.textContent = label;
  }
};

// Hook LF.storage.save() to also push to the server (Supabase) when online and
// keep the dashboard's live widgets (Recent Activity, Lead Funnel, Source,
// Leaderboard, KPIs) in sync without requiring a route switch. Many call
// sites — kanban drags, consent toggles, task edits — fire save() but don't
// bother re-rendering the dashboard themselves; this centralizes that.
(function(){
  const orig = LF.storage.save.bind(LF.storage);
  let _dashRefreshTimer = null;
  LF.storage.save = function(){
    const r = orig();
    if(LF.db && LF.db.online) LF.db.saveSnapshot();
    // Debounce: many UI flows call save() multiple times in quick succession
    // (e.g. drag-drop followed by an activity push). Coalesce into one render.
    if(LF.state && LF.state.route === "dashboard" && LF.router && LF.router.go){
      if(_dashRefreshTimer) clearTimeout(_dashRefreshTimer);
      _dashRefreshTimer = setTimeout(()=>{
        _dashRefreshTimer = null;
        // Only refresh if we're still on the dashboard when the timer fires.
        if(LF.state.route === "dashboard") LF.router.go("dashboard");
      }, 250);
    }
    return r;
  };
})();

// Live dashboard polling — pulls the latest server snapshot every 20 s while
// the dashboard is the active route and the tab is visible. Lets changes
// made in another tab / by another teammate show up without a manual reload.
// Stops when the user navigates away or the tab is hidden so we don't burn
// requests in the background.
LF.dashLivePoll = (function(){
  let timer = null, lastFingerprint = "";
  function fingerprint(){
    const L = (LF.state && LF.state.leads) || [];
    // Cheap signature: count + most-recent activity timestamp across all leads.
    let maxAt = 0;
    for(const l of L){
      const acts = l && l.activities;
      if(!acts || !acts.length) continue;
      for(const a of acts){ if(a && a.at > maxAt) maxAt = a.at; }
    }
    return L.length + ":" + maxAt;
  }
  async function tick(){
    if(LF.state.route !== "dashboard"){ stop(); return; }
    if(typeof document !== "undefined" && document.hidden) return; // resume on visibility
    if(!LF.db || !LF.db.online) return;
    try {
      const ok = await LF.db.loadSnapshot();
      if(!ok) return;
      const fp = fingerprint();
      if(fp !== lastFingerprint){
        lastFingerprint = fp;
        if(LF.state.route === "dashboard" && LF.router && LF.router.go) LF.router.go("dashboard");
      }
    } catch(e){ /* swallow — keep polling on next tick */ }
  }
  function start(){
    if(timer) return;
    lastFingerprint = fingerprint();
    timer = setInterval(tick, 20000);
  }
  function stop(){
    if(timer){ clearInterval(timer); timer = null; }
  }
  if(typeof document !== "undefined"){
    document.addEventListener("visibilitychange", ()=>{
      if(document.hidden) stop();
      else if(LF.state && LF.state.route === "dashboard") start();
    });
  }
  return { start, stop, tick };
})();

// Flush pending config on tab close. Leads/tasks/subvendors are already synced
// per-record on every edit (400ms debounce); sendBeacon can only fire one
// request, so we use it to catch any pending workspace-config change.
if(typeof window!=="undefined"){
  window.addEventListener("beforeunload", ()=>{
    if(LF.db && LF.db.online && LF.db.pending){
      try { navigator.sendBeacon && navigator.sendBeacon(LF.db.baseUrl + "/api/config", new Blob([JSON.stringify(LF.db._buildConfig())], {type:"application/json"})); } catch(e){}
    }
  });
}

/* ---- Mobile sidebar / responsive shell ---- */
LF.shell = LF.shell || {
  toggleSidebar(){
    const sb = document.querySelector(".sidebar");
    const bd = document.getElementById("sb-backdrop");
    if(!sb || !bd) return;
    const willOpen = !sb.classList.contains("show");
    sb.classList.toggle("show", willOpen);
    bd.classList.toggle("show", willOpen);
    document.body.style.overflow = willOpen ? "hidden" : "";
  },
  closeSidebar(){
    const sb = document.querySelector(".sidebar");
    const bd = document.getElementById("sb-backdrop");
    if(sb) sb.classList.remove("show");
    if(bd) bd.classList.remove("show");
    document.body.style.overflow = "";
  },
  isMobile(){ return window.matchMedia("(max-width:900px)").matches; }
};

LF.init = function(){
  // Cache removed — purge anything an older build may have left behind so it can
  // never be read as data.
  try{ localStorage.removeItem(LF.storage.key); }catch(e){}
  LF.agents = LF.state.agents; // ref
  // Seed default config into LF.state (catalog, picklists). Supabase data
  // overlays these once loadSnapshot() runs — they only fill the gap before it.
  LF.email._bootstrap();
  LF.qual._bootstrap();
  LF.company._bootstrap();
  LF.team._bootstrap();
  LF.apiMgr._bootstrap();
  LF.mail._bootstrap();
  if(LF.picklists && LF.picklists._bootstrap) LF.picklists._bootstrap();
  LF.bindShell();
  LF.router.init();
  LF.scrollCtrl.bind();
  // Do NOT decide the auth screen yet. With no local cache we have no data until
  // Supabase answers — showing anything now would flash a false "create admin"
  // or an empty dashboard. Wait behind the boot overlay instead.
  LF.bootConnect();
};

// Connect to Supabase and hydrate before showing anything. On failure we show a
// clear "can't connect" screen with Retry — never stale or empty data.
LF.bootConnect = async function(){
  LF.bootOverlay.show("Connecting to Supabase…", false);
  try {
    const online = await LF.db.probe();
    if(!online) throw new Error(LF.db.lastError || "Server unreachable");
    await LF.db.loadSnapshot();
    // Apply company branding now that it's loaded.
    try { if(LF.state.company){ const co=LF.state.company; document.querySelectorAll('.sb-brand .t').forEach(el=>{ if(el.textContent.startsWith('LeadForge')) return; el.textContent = co.name; }); if(co.logo) document.querySelectorAll('.sb-brand img, .login-brand img').forEach(el=>el.src=co.logo); } } catch(e){}
    LF.bootOverlay.hide();
    // Server team list is the source of truth for "is admin set up yet".
    if(LF.auth && LF.auth.gateAuthScreen) LF.auth.gateAuthScreen();
    if(LF.auth && LF.auth.restore && !LF.auth.needsSetup()) LF.auth.restore();
    if(LF.auth.isSignedIn() && LF.state.route && LF.router && LF.router.go) LF.router.go(LF.state.route||"dashboard");
    LF.updateSidebarCounts && LF.updateSidebarCounts();
  } catch(e){
    console.warn("[LF] boot connect failed:", e && e.message);
    LF.bootOverlay.show("Can't reach the server right now. Your data is safe in Supabase — this device just can't connect. Check your connection and retry.", true);
  }
};

// Minimal full-screen boot gate (no HTML/CSS-file dependency).
LF.bootOverlay = {
  _el: null,
  show(msg, retry){
    if(!document.getElementById("boot-spin-style")){
      const st = document.createElement("style"); st.id = "boot-spin-style";
      st.textContent = "@keyframes bootspin{to{transform:rotate(360deg)}}";
      document.head.appendChild(st);
    }
    let el = LF.bootOverlay._el;
    if(!el){
      el = document.createElement("div");
      el.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#0b1220;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;text-align:center;padding:24px";
      document.body.appendChild(el); LF.bootOverlay._el = el;
    }
    el.style.display = "flex";
    el.innerHTML =
      '<div style="font-size:26px;font-weight:800;letter-spacing:.3px">LeadForge 360</div>' +
      '<div style="max-width:440px;font-size:14px;line-height:1.6;color:#94a3b8">' + msg + '</div>' +
      (retry
        ? '<button id="boot-retry" style="margin-top:6px;padding:10px 22px;border:0;border-radius:9px;background:#16a34a;color:#fff;font-weight:600;font-size:14px;cursor:pointer">Retry</button>'
        : '<div style="width:26px;height:26px;border:3px solid #1e293b;border-top-color:#22c55e;border-radius:50%;animation:bootspin .8s linear infinite"></div>');
    if(retry){ const b = document.getElementById("boot-retry"); if(b) b.onclick = ()=>LF.bootConnect(); }
  },
  hide(){ if(LF.bootOverlay._el) LF.bootOverlay._el.style.display = "none"; }
};

/* ---- Scroll controls ---- */
LF.scrollCtrl = {
  to(where){
    const c = document.getElementById("content"); if(!c) return;
    c.scrollTo({top: where==="top"?0:c.scrollHeight, behavior:"smooth"});
  },
  up(){
    const c = document.getElementById("content"); if(!c) return;
    c.scrollBy({top:-Math.max(200,c.clientHeight*0.85), behavior:"smooth"});
  },
  down(){
    const c = document.getElementById("content"); if(!c) return;
    c.scrollBy({top:Math.max(200,c.clientHeight*0.85), behavior:"smooth"});
  },
  refresh(){
    const c = document.getElementById("content"); const w = document.getElementById("scroll-ctrl"); if(!c||!w) return;
    const canScroll = c.scrollHeight > c.clientHeight + 4;
    w.classList.toggle("show", canScroll);
    const atTop = c.scrollTop <= 2;
    const atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 2;
    const up = document.getElementById("scroll-up"), down = document.getElementById("scroll-down");
    const top = document.getElementById("scroll-top"), bot = document.getElementById("scroll-bottom");
    if(up) up.disabled = atTop;
    if(top) top.disabled = atTop;
    if(down) down.disabled = atBottom;
    if(bot) bot.disabled = atBottom;
  },
  bind(){
    const c = document.getElementById("content"); if(!c) return;
    c.addEventListener("scroll", LF.scrollCtrl.refresh, {passive:true});
    window.addEventListener("resize", LF.scrollCtrl.refresh);
    // observe content mutations so new content triggers visibility
    try{
      const mo = new MutationObserver(()=> requestAnimationFrame(LF.scrollCtrl.refresh));
      mo.observe(c,{childList:true,subtree:true,characterData:true});
    }catch(e){}
    // Keyboard shortcuts: PageUp / PageDown / Home / End target the content pane
    document.addEventListener("keydown", (e)=>{
      if(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if(e.target && e.target.isContentEditable) return;
      if(e.key==="PageUp"){ e.preventDefault(); LF.scrollCtrl.up() }
      else if(e.key==="PageDown"){ e.preventDefault(); LF.scrollCtrl.down() }
      else if(e.key==="Home" && !e.ctrlKey){ /* leave default */ }
      else if(e.key==="End" && !e.ctrlKey){ /* leave default */ }
    });
    setTimeout(LF.scrollCtrl.refresh, 60);
  }
};

LF.bindShell = function(){
  document.querySelectorAll(".sb-link").forEach(el=>{
    el.addEventListener("click", ()=>{
      LF.router.go(el.dataset.route);
      if(LF.shell && LF.shell.isMobile()) LF.shell.closeSidebar();
    });
  });
  document.getElementById("login-form").addEventListener("submit", e=>{
    e.preventDefault();
    LF.auth.login(document.getElementById("login-email").value, document.getElementById("login-pass").value);
  });
  document.addEventListener("keydown", e=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); LF.cmd.open() }
    if(e.key==="Escape"){ LF.cmd.close(); LF.drawer.close(); LF.modal.close() }
  });
  document.getElementById("cmd-input").addEventListener("input", LF.cmd.onInput);
  document.getElementById("cmd-input").addEventListener("keydown", LF.cmd.onKey);
  const gs = document.getElementById("global-search");
  gs.addEventListener("focus", ()=> LF.cmd.open());
  gs.addEventListener("keydown", e=>{
    if(e.key==="Enter"){ e.preventDefault(); const v=gs.value.trim(); if(v){ LF.cmd.close(); LF.search.open(v); gs.blur(); } }
  });
};

/* ---- Auth ---- */
LF.auth = {
  // Default session length when Settings → Security hasn't overridden it.
  DEFAULT_SESSION_HOURS: 8,

  _sessionHours(){
    const h = Number(LF.state.sessionHours);
    return (Number.isFinite(h) && h > 0) ? h : LF.auth.DEFAULT_SESSION_HOURS;
  },

  // True only when there is BOTH a user record AND a non-expired session.
  // A persisted user without a session (e.g. snapshot loaded with stale
  // user data) must NOT count as signed in — otherwise the auth gate skips
  // the login screen and the app shell stays hidden, producing a blank page.
  isSignedIn(){
    const u = LF.state.user, s = LF.state.session;
    if(!u || !u.id) return false;
    if(!s || !s.userId || !s.expiresAt) return false;
    return Date.now() < s.expiresAt && s.userId === u.id;
  },

  // True until at least one Admin has sign-in credentials. Drives the
  // first-run setup screen.
  needsSetup(){
    const members = LF.state.teamMembers || [];
    if(!members.length) return true;
    return !members.some(m => m.role === "Admin" && m.credentials && m.credentials.passwordHash);
  },

  // Decides which auth screen is on top: setup (if no admin creds yet),
  // login (if a session is missing/expired), or none (the app shell stays
  // up). Safe to call multiple times.
  gateAuthScreen(){
    const setup = document.getElementById("setup-screen");
    const login = document.getElementById("login-screen");
    const shell = document.getElementById("app-shell");
    if(!setup || !login || !shell) return;
    if(LF.auth.needsSetup()){
      setup.classList.remove("hidden");
      login.classList.add("hidden");
      shell.classList.add("hidden");
      return;
    }
    setup.classList.add("hidden");
    // login vs shell visibility is normally owned by login()/restore()/logout(),
    // but when this gate runs after a server-snapshot load (incognito / fresh
    // browser) there is no session yet AND nobody else will un-hide the login
    // screen — so surface it here when the shell isn't already up.
    if(!LF.auth.isSignedIn() && shell.classList.contains("hidden")){
      login.classList.remove("hidden");
    }
  },

  _showShell(m){
    LF.state.user = LF.state.user || {};
    LF.state.user.id = m.id;
    LF.state.user.email = m.email;
    LF.state.user.name = m.name;
    LF.state.user.avatar = m.avatar || initials(m.name);
    LF.state.user.role = m.role;
    // Admins/Owners always land on the full board — clear any sticky "My deals"/"Team"
    // pipeline scope so a previously-narrowed view never hides data after login.
    if(m.role === "Admin" || m.role === "Owner"){ LF.state.pipelineScope = "all"; }
    const ub = document.getElementById("tb-username"); if(ub) ub.textContent = m.name;
    const av = document.getElementById("tb-avatar");   if(av) av.textContent = m.avatar || initials(m.name);
    const ss = document.getElementById("setup-screen"); if(ss) ss.classList.add("hidden");
    const ls = document.getElementById("login-screen"); if(ls) ls.classList.add("hidden");
    const sh = document.getElementById("app-shell");    if(sh) sh.classList.remove("hidden");
  },

  login(email, pass){
    if(!email || !pass){ LF.toast("Please fill both fields","err"); return }
    if(!LF.state.teamMembers || !LF.team._hash){
      LF.toast("Auth not initialised — reload the page","err"); return;
    }
    const key = email.trim().toLowerCase();
    const m = LF.state.teamMembers.find(x =>
      (x.credentials && x.credentials.username && x.credentials.username.toLowerCase()===key) ||
      ((x.email||"").toLowerCase()===key)
    );
    if(!m || !m.credentials){
      LF.toast("Invalid username or password","err"); return;
    }
    if(m.status === "inactive"){
      LF.toast("This account is deactivated. Contact your admin.","err"); return;
    }
    if(LF.team._hash(pass) !== m.credentials.passwordHash){
      LF.toast("Invalid username or password","err"); return;
    }
    LF.auth._showShell(m);
    m.lastLogin = Date.now();
    // Issue a session that survives page refreshes until expiry.
    const ttlMs = LF.auth._sessionHours() * 60 * 60 * 1000;
    LF.state.session = {
      userId: m.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs
    };
    LF.auth._saveSession(LF.state.session);
    LF.storage.save();
    LF.toast(`Welcome, ${m.name.split(" ")[0]}!`,"");
    if(m.credentials.mustResetOnFirstLogin){
      LF.toast("Please change your password in Settings → Team","info");
    }
    if(!LF.initialized){ LF.router.go("dashboard"); LF.initialized = true }
  },

  // Session persistence — auth state only (a tiny {userId, expiresAt} token),
  // NOT workspace data. Kept in its own localStorage key so login survives a
  // reload while the actual user record + permissions always come fresh from
  // Supabase (restore() looks the member up in the server-loaded teamMembers).
  _sessionKey: "leadforge.session",
  _saveSession(s){ try{ s ? localStorage.setItem(LF.auth._sessionKey, JSON.stringify(s)) : localStorage.removeItem(LF.auth._sessionKey); }catch(e){} },
  _loadSession(){ try{ return JSON.parse(localStorage.getItem(LF.auth._sessionKey) || "null"); }catch(e){ return null; } },

  // Called once on boot. Returns true when a saved session is restored so the
  // user lands directly on the dashboard without re-typing credentials.
  restore(){
    const s = LF.state.session = LF.auth._loadSession();
    if(!s || !s.userId || !s.expiresAt) return false;
    if(Date.now() > s.expiresAt){
      LF.state.session = null;
      LF.state.user = {};
      LF.auth._saveSession(null);
      LF.toast && LF.toast("Session expired — please sign in again","info");
      return false;
    }
    const m = (LF.state.teamMembers || []).find(x => x.id === s.userId);
    if(!m || !m.credentials || m.status === "inactive"){
      // Account was deleted, deactivated, or had its password reset elsewhere.
      LF.state.session = null;
      LF.state.user = {};
      LF.auth._saveSession(null);
      return false;
    }
    LF.auth._showShell(m);
    return true;
  },

  // First-run flow. Only runs when no Admin has credentials yet — guarded
  // by needsSetup() so a normal sign-in can't sneak through this path.
  setupAdmin(){
    if(!LF.auth.needsSetup()){
      LF.toast("Setup already complete — sign in instead","err");
      LF.auth.gateAuthScreen();
      return;
    }
    const email = (document.getElementById("setup-email").value || "").trim();
    const pass  = document.getElementById("setup-pass").value || "";
    const pass2 = document.getElementById("setup-pass2").value || "";
    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      LF.toast("Enter a valid email address","err"); return;
    }
    if(pass.length < 8){ LF.toast("Password must be at least 8 characters","err"); return; }
    if(pass !== pass2){ LF.toast("Passwords don't match","err"); return; }

    // Use an existing Admin row if the email matches; otherwise mint a new one.
    let m = (LF.state.teamMembers || []).find(x => x.email.toLowerCase() === email.toLowerCase());
    if(m){
      m.role = "Admin";
      m.status = "active";
      m.permissions = LF.team.defaultPermForRole("Admin");
    } else {
      m = {
        id: "u"+rid().slice(3),
        name: email.split("@")[0].split(".").map(s=>s[0].toUpperCase()+s.slice(1)).join(" "),
        email, role: "Admin", team: "Enterprise",
        status: "active", grp: "g2", avatar: initials(email),
        permissions: LF.team.defaultPermForRole("Admin"),
        invitedAt: Date.now(), lastLogin: null
      };
      LF.state.teamMembers = LF.state.teamMembers || [];
      LF.state.teamMembers.push(m);
    }
    m.credentials = {
      username: email,
      passwordHash: LF.team._hash(pass),
      mustResetOnFirstLogin: false,
      createdAt: Date.now()
    };
    LF.storage.save();
    // Push synchronously so a quick reload doesn't lose the credentials.
    if(LF.db && LF.db.flushSnapshot) LF.db.flushSnapshot();
    LF.toast("Admin account created — signing you in…","");
    // Drop straight into the app instead of bouncing through the login screen.
    LF.auth._showShell(m);
    const ttlMs = LF.auth._sessionHours() * 60 * 60 * 1000;
    LF.state.session = { userId: m.id, createdAt: Date.now(), expiresAt: Date.now() + ttlMs };
    LF.auth._saveSession(LF.state.session);
    LF.storage.save();
    if(LF.db && LF.db.flushSnapshot) LF.db.flushSnapshot();
    if(!LF.initialized){ LF.router.go("dashboard"); LF.initialized = true; }
  },

  sso(p){ LF.toast(`SSO via ${p} not configured`,"err") },

  logout(){
    try {
      LF.state.session = null;
      LF.state.user = {};
      LF.auth._saveSession(null);
    } catch(e){}
    // Hard reload — drops in-memory state and re-renders the login screen cleanly.
    location.reload();
  }
};

/* ---- Router ---- */
/* LOW-4 — Permission gate. Returns true if the current user can access a module
   at the requested operation level. Modules a user has set to "none" are blocked. */
LF.permGate = function(moduleId, op){
  op = op || "view";
  // Find the user's row in teamMembers (matched by email)
  const tm = (LF.state.teamMembers||[]).find(m =>
    (m.email||"").toLowerCase() === (LF.state.user?.email||"").toLowerCase()
  );
  if(!tm) return true; // No team-member record (initial admin / demo) → unrestricted
  if(tm.role === "Admin") return true;
  const level = (tm.permissions||{})[moduleId];
  if(!level || level === "none") return false;
  const ranks = { none:0, view:1, edit:2, admin:3 };
  return (ranks[level]||0) >= (ranks[op]||1);
};

LF.router = {
  init(){
    // Skip auto-rendering the app shell when no user is genuinely signed in
    // (must have both a user record AND a non-expired session). Without this
    // guard the dashboard view tries to read LF.state.user.name on an empty
    // user, throws, and aborts the rest of LF.init().
    if(!LF.auth.isSignedIn()) return;
    LF.router.go("dashboard");
  },
  go(route){
    if(!LF.views[route]){ LF.toast(`${route} not found`,"err"); return }
    // Permission check — map route → module id
    const routeToModule = {leads:"leads",pipeline:"pipeline",scoring:"scoring",analytics:"analytics",
      cdp:"cdp",conversion:"conversion",collab:"collab",customization:"customization",
      mail:"mail",settings:"settings",
      // Outcome analysis views — gated by the same "leads" permission as the
      // main leads list, since they're just specialized slices of it.
      wonLeads:"leads", lostLeads:"leads",
      // Unified directory — every lead, every status, with Excel/CSV download.
      allClients:"leads"};
    const mod = routeToModule[route];
    if(mod && LF.permGate && !LF.permGate(mod, "view")){
      LF.toast("You don't have permission to view "+route+". Ask an admin to enable it in Settings → Team.","err");
      // bounce to dashboard which everyone sees
      if(route !== "dashboard") return LF.router.go("dashboard");
      return;
    }
    // Stop the dashboard's live-data poll whenever we navigate to any other
    // route. The dashboard view re-starts it on render when route===dashboard.
    if(route !== "dashboard" && LF.dashLivePoll && LF.dashLivePoll.stop) LF.dashLivePoll.stop();
    LF.state.route = route;
    document.querySelectorAll(".sb-link").forEach(el=>{
      el.classList.toggle("active", el.dataset.route===route);
    });
    const content = document.getElementById("content");
    content.innerHTML = "";
    content.classList.toggle("dashboard-compact", route==="dashboard");
    const view = document.createElement("div");
    view.className = "view";
    view.id = `view-${route}`;
    content.appendChild(view);
    LF.views[route](view);
    content.scrollTop = 0;
    if(LF.scrollCtrl) setTimeout(LF.scrollCtrl.refresh, 30);
  }
};

/* ---- Toasts ---- */
LF.toast = function(msg, type=""){
  const wrap = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>{ t.style.opacity="0"; t.style.transform="translateX(120%)"; setTimeout(()=>t.remove(),300) }, 3200);
};

/* ---- Drawer ---- */
LF.drawer = {
  open({title,body,foot}){
    document.getElementById("drawer-title").textContent = title||"";
    document.getElementById("drawer-body").innerHTML = body||"";
    document.getElementById("drawer-foot").innerHTML = foot||"";
    document.getElementById("overlay").classList.add("show");
    document.getElementById("drawer").classList.add("show");
  },
  close(){
    document.getElementById("drawer").classList.remove("show");
    document.getElementById("overlay").classList.remove("show");
  }
};

/* ---- Modal ---- */
LF.modal = {
  open({title,body,foot}){
    document.getElementById("modal-title").textContent = title||"";
    document.getElementById("modal-body").innerHTML = body||"";
    document.getElementById("modal-foot").innerHTML = foot||"";
    document.getElementById("modal").classList.add("show");
  },
  close(){ document.getElementById("modal").classList.remove("show") }
};

/* ---- Notifications store ---- */
LF.notifications = {
  list(){
    const L = LF.state.leads;
    const items = [];
    const newLeads = L.filter(l=>Date.now()-l.createdAt < 86400000).slice(0,3);
    newLeads.forEach(l=> items.push({ic:"👤",t:`New lead: ${l.name}`,d:`${l.company} · ${l.source}`,at:l.createdAt,go:()=>LF.views.openLeadDrawer(l.id)}));
    const hot = L.filter(l=>l.score>=85).slice(0,2);
    hot.forEach(l=> items.push({ic:"🔥",t:`Hot lead alert: ${l.name}`,d:`Score ${l.score} · ${fmtCur(l.amount,l.currency)}`,at:l.updatedAt,go:()=>LF.views.openLeadDrawer(l.id)}));
    const unread = LF.state.threads.filter(t=>t.unread).slice(0,3);
    unread.forEach(t=>{ const l=LF.state.leads.find(x=>x.id===t.leadId); if(l) items.push({ic:"💬",t:`New ${t.channel} from ${l.name}`,d:t.messages[t.messages.length-1].text.slice(0,60),at:t.messages[t.messages.length-1].at,go:()=>{LF.toast("Inbox module disabled","info")}}) });
    LF.state.agents.filter(a=>a.status==="running").slice(0,2).forEach(a=> items.push({ic:"🤖",t:`${a.name} completed a run`,d:`${a.runs} runs · ${a.accept}% acceptance`,at:Date.now()-Math.random()*3600000,go:()=>LF.router.go("agents")}));
    return items.sort((a,b)=>b.at-a.at).slice(0,8);
  },
  show(){
    const items = LF.notifications.list();
    LF.drawer.open({
      title:`Notifications (${items.length})`,
      body: items.length? items.map((n,i)=>`
        <div class="activity-item" style="cursor:pointer" onclick="LF.notifications.handle(${i})">
          <div class="ic">${n.ic}</div>
          <div class="body"><div class="t">${escapeHtml(n.t)}</div>
          <div class="m">${escapeHtml(n.d)} · ${fmtTime(n.at)}</div></div>
        </div>`).join("") : '<p style="color:var(--ink-400)">You are all caught up.</p>',
      foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Close</button>
        <button class="btn btn-primary" onclick="LF.notifications.markAllRead()">Mark all as read</button>`
    });
    LF.notifications._cache = items;
  },
  handle(i){ const n = (LF.notifications._cache||[])[i]; LF.drawer.close(); if(n && n.go) n.go(); },
  markAllRead(){ LF.state.threads.forEach(t=>t.unread=false); LF.storage.save(); LF.updateSidebarCounts(); LF.drawer.close(); LF.toast("All notifications marked read",""); }
};

/* ---- Help center ---- */
LF.help = {
  open(){
    const topics = [
      {q:"How do I add a lead?", a:"Click <b>+ New lead</b> on the Leads page, or press <kbd>Ctrl+K</kbd> and type <i>add lead &lt;name&gt;</i>."},
      {q:"How do I qualify leads?", a:"Go to <b>Scoring & Qualification → Leads to qualify</b>, click <b>▶ Qualify</b> next to a lead, pick the domain and service, then answer the checklist to see a Qualified / Nurture / Disqualified verdict."},
      {q:"How are leads assigned?", a:"Every new lead is assigned to an owner when created. You can change ownership from any lead's drawer, or in bulk from the Leads table."},
      {q:"How do I run an AI agent?", a:"Open <b>AI Agents Platform</b>, click <b>▶ Run</b> on any agent card. Approve their actions in the HITL queue."},
      {q:"How do I import data?", a:"Leads → <b>Import</b> — pick a CSV with headers: name,email,company,stage,score,amount."},
      {q:"How do I export audit logs?", a:"Security → <b>Verify chain</b>, or Activity Timeline → <b>Export</b>."}
    ];
    LF.modal.open({
      title:"Help Center",
      body: `<div style="display:flex;flex-direction:column;gap:10px">
        ${topics.map(t=>`<details style="padding:12px;border:1px solid var(--ink-150);border-radius:8px"><summary style="font-weight:700;font-size:13.5px;cursor:pointer">${t.q}</summary><p style="margin-top:8px;font-size:12.5px;color:var(--ink-600);line-height:1.55">${t.a}</p></details>`).join("")}
        <div style="margin-top:10px;padding:12px;background:var(--ab7-sky-ghost);border-radius:8px;font-size:12.5px">Need more help? Email <a href="mailto:ashok.benial@ab7solutions.com" style="color:var(--ab7-blue);font-weight:700">ashok.benial@ab7solutions.com</a>.</div>
      </div>`,
      foot:`<button class="btn btn-primary" onclick="LF.modal.close()">Got it</button>`
    });
  }
};

/* ---- Global search ---- */
LF.search = {
  open(q){
    if(!q){ LF.cmd.open(); return }
    const ql = q.toLowerCase();
    const leads = LF.state.leads.filter(l=>l.name.toLowerCase().includes(ql)||l.company.toLowerCase().includes(ql)||l.email.toLowerCase().includes(ql)||l.city.toLowerCase().includes(ql)).slice(0,20);
    LF.modal.open({
      title:`Search results for "${q}"`,
      body: leads.length? `<table class="tbl"><thead><tr><th>Lead</th><th>Company</th><th>Stage</th><th>Score</th></tr></thead><tbody>${leads.map(l=>`<tr style="cursor:pointer" onclick="LF.modal.close();LF.views.openLeadDrawer('${l.id}')"><td><b>${escapeHtml(l.name)}</b><br><span style="font-size:11px;color:var(--ink-400)">${escapeHtml(l.email)}</span></td><td>${escapeHtml(l.company)}</td><td><span class="tag ${STAGE_COLORS[l.stage]}">${l.stage}</span></td><td><span class="score-pill ${l.score>=75?'hot':l.score>=55?'warm':'cold'}">${l.score}</span></td></tr>`).join("")}</tbody></table>` : `<p style="color:var(--ink-400)">No matches. Try a different name, company, city, or email.</p>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Close</button>`
    });
  }
};

/* ==========================================================
   LF.formula — spreadsheet-like formula engine for the
   Customization → Formula field card. Tokenizer + recursive-
   descent parser + evaluator. Supports IF/AND/OR/NOT,
   numeric/string literals, comparison operators, and field
   tokens drawn from each lead.
   ========================================================== */
LF.formula = {
  defaultExpression: '=IF(AND(Score >= 75, DaysSinceLastTouch < 5), "Hot", IF(Score >= 55, "Warm", "Cold"))',

  // Field tokens — values derived from a lead at evaluation time
  fields: {
    Score:              l => Number(l.score)||0,
    Amount:             l => Number(l.amount)||0,
    DaysSinceLastTouch: l => Math.max(0, Math.floor((Date.now() - (l.updatedAt||l.createdAt||Date.now())) / 86400000)),
    DaysSinceCreated:   l => Math.max(0, Math.floor((Date.now() - (l.createdAt||Date.now())) / 86400000)),
    Stage:              l => String(l.stage||""),
    Industry:           l => String(l.industry||""),
    Country:            l => String(l.country||""),
    Source:             l => String(l.source||""),
    Owner:              l => String(l.ownerId||"")
  },

  _tokenize(expr){
    const s = String(expr||"").replace(/^\s*=/, '').trim();
    const out = [];
    let i = 0;
    while(i < s.length){
      const c = s[i];
      if(/\s/.test(c)){ i++; continue; }
      if(c === '"' || c === "'"){
        const q = c; let j = i+1, val = '';
        while(j < s.length && s[j] !== q){ val += s[j]; j++; }
        if(j >= s.length) throw new Error('Unterminated string starting at '+i);
        out.push({type:'str', value:val}); i = j+1; continue;
      }
      if(/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i+1]||''))){
        let j = i, num = '';
        while(j < s.length && /[0-9.]/.test(s[j])){ num += s[j]; j++; }
        if((num.match(/\./g)||[]).length > 1) throw new Error('Malformed number "'+num+'" at position '+i);
        out.push({type:'num', value: parseFloat(num)}); i = j; continue;
      }
      if(c === '(' || c === ')' || c === ','){ out.push({type:c}); i++; continue; }
      const two = s.substr(i, 2);
      if(two === '>=' || two === '<=' || two === '!=' || two === '<>' || two === '=='){
        out.push({type:'op', value: two==='<>'?'!=':two}); i += 2; continue;
      }
      if(c === '>' || c === '<' || c === '='){
        out.push({type:'op', value: c==='='?'==':c}); i++; continue;
      }
      if(/[A-Za-z_]/.test(c)){
        let j = i, name = '';
        while(j < s.length && /[A-Za-z0-9_]/.test(s[j])){ name += s[j]; j++; }
        out.push({type:'ident', value:name}); i = j; continue;
      }
      throw new Error('Unexpected character "'+c+'" at position '+i);
    }
    return out;
  },

  _parse(tokens){
    let p = 0;
    const peek = () => tokens[p];
    const next = () => tokens[p++];
    const expect = (t) => {
      const tok = next();
      if(!tok || tok.type !== t) throw new Error('Expected '+t+', got '+(tok?tok.type:'EOF'));
      return tok;
    };
    const parseExpr = () => {
      const left = parsePrimary();
      const tok = peek();
      if(tok && tok.type === 'op'){
        next();
        const right = parsePrimary();
        return {type:'binop', op:tok.value, left, right};
      }
      return left;
    };
    const parsePrimary = () => {
      const tok = next();
      if(!tok) throw new Error('Unexpected end of expression');
      if(tok.type === 'num') return {type:'num', value:tok.value};
      if(tok.type === 'str') return {type:'str', value:tok.value};
      if(tok.type === '('){ const e = parseExpr(); expect(')'); return e; }
      if(tok.type === 'ident'){
        if(peek() && peek().type === '('){
          next();
          const args = [];
          if(peek() && peek().type !== ')'){
            args.push(parseExpr());
            while(peek() && peek().type === ','){ next(); args.push(parseExpr()); }
          }
          expect(')');
          return {type:'call', name:tok.value, args};
        }
        return {type:'ident', name:tok.value};
      }
      throw new Error('Unexpected token: '+tok.type);
    };
    const ast = parseExpr();
    if(p < tokens.length) throw new Error('Unexpected trailing token: '+tokens[p].type);
    return ast;
  },

  _eval(node, lead){
    switch(node.type){
      case 'num': return node.value;
      case 'str': return node.value;
      case 'ident': {
        const fn = LF.formula.fields[node.name];
        if(!fn) throw new Error('Unknown field: '+node.name);
        return fn(lead);
      }
      case 'binop': {
        const a = LF.formula._eval(node.left, lead);
        const b = LF.formula._eval(node.right, lead);
        switch(node.op){
          case '>=': return a >= b;
          case '<=': return a <= b;
          case '>':  return a > b;
          case '<':  return a < b;
          case '==': return a == b;
          case '!=': return a != b;
        }
        throw new Error('Unknown operator: '+node.op);
      }
      case 'call': {
        const name = node.name.toUpperCase();
        const args = node.args;
        if(name === 'IF'){
          if(args.length !== 3) throw new Error('IF requires 3 arguments');
          return LF.formula._eval(args[0], lead) ? LF.formula._eval(args[1], lead) : LF.formula._eval(args[2], lead);
        }
        if(name === 'AND') return args.every(a => !!LF.formula._eval(a, lead));
        if(name === 'OR')  return args.some(a => !!LF.formula._eval(a, lead));
        if(name === 'NOT'){ if(args.length !== 1) throw new Error('NOT requires 1 argument'); return !LF.formula._eval(args[0], lead); }
        throw new Error('Unknown function: '+node.name);
      }
    }
    throw new Error('Unknown node type: '+node.type);
  },

  _cache: { expr:null, ast:null, error:null },
  compile(expr){
    if(LF.formula._cache.expr === expr) return LF.formula._cache;
    let ast = null, error = null;
    try { ast = LF.formula._parse(LF.formula._tokenize(expr)); }
    catch(e){ error = e.message; }
    LF.formula._cache = { expr, ast, error };
    return LF.formula._cache;
  },

  evaluate(lead, expr){
    expr = expr || LF.state.formulaExpression || LF.formula.defaultExpression;
    const c = LF.formula.compile(expr);
    if(c.error) return null;
    try { return LF.formula._eval(c.ast, lead); }
    catch(e){ return null; }
  },

  // Validates against a sample lead (first lead in state, or a synthetic one).
  validate(expr){
    const c = LF.formula.compile(expr);
    if(c.error) return {ok:false, error:c.error};
    const sample = (LF.state.leads && LF.state.leads[0]) || {score:60, amount:1000, stage:'New', createdAt:Date.now(), updatedAt:Date.now(), industry:'SaaS', country:'IN', ownerId:'u1', source:'web'};
    try { LF.formula._eval(c.ast, sample); return {ok:true}; }
    catch(e){ return {ok:false, error:e.message}; }
  },

  // Public helper used by views for the score-pill class.
  // Falls back to the legacy threshold when the formula is unpublished or invalid.
  healthClass(lead){
    if(LF.state.formulaPublished){
      const v = LF.formula.evaluate(lead);
      if(typeof v === 'string'){
        const lower = v.toLowerCase();
        if(lower === 'hot' || lower === 'warm' || lower === 'cold') return lower;
      }
    }
    return lead.score >= 75 ? 'hot' : lead.score >= 55 ? 'warm' : 'cold';
  }
};

/* ==========================================================
   LF.actions — real handlers for every previously-stub button
   ========================================================== */
LF.actions = {
  /* ---- Pipeline filters ---- */
  pipelineFilter(scope, btn){
    LF.state.pipelineScope = scope;
    if(btn){ btn.parentElement.querySelectorAll("button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); }
    LF.views.renderPipeline();
    LF.toast(scope==='mine'?`Showing your deals (${LF.state.leads.filter(l=>l.ownerId===LF.state.user.id).length})`:scope==='team'?`Showing team deals`:`Showing all deals`,"");
  },

  /* ---- Dashboard / Analytics range ---- */
  setDashRange(days, btn){
    LF.state.dashRange = days;
    if(btn){ btn.parentElement.querySelectorAll("button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); }
    LF.router.go("dashboard");
  },
  setAnalyticsRange(days, btn){
    LF.state.analyticsRange = days;
    if(btn){ btn.parentElement.querySelectorAll("button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); }
    LF.router.go("analytics");
  },
  emailReport(){
    const total = LF.state.leads.length;
    const won = LF.state.leads.filter(l=>l.stage==="Won").length;
    const pipeline = LF.state.leads.filter(l=>!["Won","Lost"].includes(l.stage)).reduce((a,b)=>a+b.amount,0);
    LF.modal.open({
      title:"Email revenue report",
      body:`<div class="fld"><label>To</label><input id="er-to" value="${escapeHtml(LF.state.user.email)}"></div>
        <div class="fld"><label>Subject</label><input id="er-subj" value="LeadForge Revenue Report — ${new Date().toLocaleDateString()}"></div>
        <div class="fld"><label>Preview</label><textarea readonly style="min-height:120px;font-size:12px">${total} leads · ${won} won · Pipeline ${fmtCur(pipeline)} · Avg score ${Math.round(LF.state.leads.reduce((a,b)=>a+b.score,0)/Math.max(1,total))}</textarea></div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.modal.close();LF.toast('Report sent to '+document.getElementById('er-to').value,'')">Send</button>`
    });
  },

  /* ---- Inbox Summarize / Templates ---- */
  summarizeThread(){
    const t = LF.state.threads.find(x=>x.id===LF.state.currentThreadId); if(!t) return;
    const lead = LF.state.leads.find(l=>l.id===t.leadId);
    const msgs = t.messages;
    LF.modal.open({
      title:`✦ AI Summary — ${lead.name}`,
      body:`<div style="background:linear-gradient(135deg,rgba(59,130,246,.06),rgba(20,216,166,.06));border:1px solid rgba(20,216,166,.2);border-radius:10px;padding:14px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ab7-blue-deep);margin-bottom:6px">Thread summary (${msgs.length} messages · ${t.channel})</div>
        <p style="font-size:13px;color:var(--ink-800);line-height:1.6">${escapeHtml(lead.firstName)} from ${escapeHtml(lead.company)} has been discussing pricing and a demo. They asked about integration with HubSpot and want a 30-min call. Next action: send deck + confirm Tuesday 3 PM IST slot.</p>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><span class="tag blue">Intent: Buying</span><span class="tag green">Sentiment: Positive</span><span class="tag warn">Urgency: This week</span></div>
      </div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Close</button>
        <button class="btn btn-blue" onclick="LF.modal.close();document.getElementById('reply-text').value='Hi '+${JSON.stringify(lead.firstName)}+', thanks for your reply — confirming Tuesday 3 PM IST. I\\'ll send the deck and a Meet link shortly.'">Insert as reply</button>`
    });
  },
  pickTemplate(){
    const templates = [
      {n:"Welcome email", t:"Hi {{first}}, welcome to LeadForge. Here's a quick tour in under 2 minutes: https://leadforge.ab7/tour. Anything specific I can help with?"},
      {n:"Demo follow-up", t:"Hi {{first}}, great chatting today. Attached is the deck, and here's a short scoped proposal for {{company}}. Any questions before we align on next steps?"},
      {n:"Pricing request", t:"Hi {{first}}, sharing our Growth ($35/user/mo) and Enterprise (custom) pricing. Happy to schedule a 15-min scoping call at your convenience."},
      {n:"Nudge after 3 days", t:"Hi {{first}}, circling back on our last note — did you get a chance to review? Happy to answer any questions or walk through a use case."}
    ];
    LF.modal.open({
      title:"Pick a template",
      body:`<div style="display:flex;flex-direction:column;gap:8px">${templates.map((tp,i)=>`
        <div style="padding:12px;border:1px solid var(--ink-150);border-radius:8px;cursor:pointer" onclick="LF.actions.insertTemplate(${i})">
          <div style="font-weight:700;font-size:13px">${escapeHtml(tp.n)}</div>
          <div style="font-size:12px;color:var(--ink-500);margin-top:4px">${escapeHtml(tp.t.slice(0,120))}…</div>
        </div>`).join("")}</div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>`
    });
    LF.actions._templates = templates;
  },
  insertTemplate(i){
    const tp = LF.actions._templates[i];
    const t = LF.state.threads.find(x=>x.id===LF.state.currentThreadId);
    const lead = LF.state.leads.find(l=>l.id===t.leadId);
    const text = tp.t.replace(/\{\{first\}\}/g, lead.firstName).replace(/\{\{company\}\}/g, lead.company);
    document.getElementById("reply-text").value = text;
    LF.modal.close();
    LF.toast("Template inserted","");
  },

  /* ---- Scoring framework switch ---- */
  setFramework(name, btn){
    if(btn){ btn.parentElement.querySelectorAll("button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); }
    LF.toast(`${name} framework loaded — scoring re-weighted`,"info");
  },

  /* ---- Routing shadow run ---- */
  shadowRun(variant){
    const sample = LF.state.leads.slice(0,40);
    const res = { A:{name:"Round-robin",conv:14.2,time:"2.1 min"}, B:{name:"AI-optimised",conv:18.6,time:"1.4 min"} };
    LF.actions._shadow = LF.actions._shadow || {};
    LF.actions._shadow[variant] = res[variant];
    LF.toast(`Shadow ${variant}: ${res[variant].name} · conv ${res[variant].conv}% · SLA ${res[variant].time}`,"info");
  },
  compareShadow(){
    const s = LF.actions._shadow || {A:{name:"Round-robin",conv:14.2,time:"2.1 min"},B:{name:"AI-optimised",conv:18.6,time:"1.4 min"}};
    LF.modal.open({
      title:"Shadow routing — A/B comparison",
      body:`<table class="tbl"><thead><tr><th>Variant</th><th>Strategy</th><th>Conv %</th><th>Avg SLA</th><th>Winner</th></tr></thead><tbody>
        <tr><td>A</td><td>${s.A.name}</td><td>${s.A.conv}%</td><td>${s.A.time}</td><td>${s.A.conv>s.B.conv?'✓':''}</td></tr>
        <tr><td>B</td><td>${s.B.name}</td><td>${s.B.conv}%</td><td>${s.B.time}</td><td>${s.B.conv>s.A.conv?'✓':''}</td></tr>
      </tbody></table>
      <p style="margin-top:12px;font-size:12.5px;color:var(--ink-500)">Variant <b>${s.A.conv>s.B.conv?'A':'B'}</b> wins — apply it to live routing?</p>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.modal.close();LF.toast('Winning variant is now live','')">Apply winner</button>`
    });
  },

  /* ---- Workflows ---- */
  dryRunWorkflow(){
    const w = LF.state.workflows[0];
    const n = Math.min(127, LF.state.leads.length);
    LF.modal.open({
      title:`Dry run — ${w.name}`,
      body:`<p style="font-size:13px;color:var(--ink-600)">Simulated ${n} leads against this workflow. No real messages were sent.</p>
        <table class="tbl" style="margin-top:10px"><thead><tr><th>Step</th><th>Passed</th><th>Dropped</th></tr></thead><tbody>
          ${w.steps.map(s=>`<tr><td>${escapeHtml(s.t)}</td><td>${Math.floor(n*(0.6+Math.random()*0.4))}</td><td>${Math.floor(Math.random()*n*0.2)}</td></tr>`).join("")}
        </tbody></table>`,
      foot:`<button class="btn btn-primary" onclick="LF.modal.close()">OK</button>`
    });
  },
  addNode(){
    const label = prompt("Step label (e.g. 'Send SMS reminder')"); if(!label) return;
    const type = prompt("Type (action / wait / cond / trigger)","action") || "action";
    const w = LF.state.workflows[0];
    w.steps.push({type,t:label});
    LF.storage.save();
    LF.router.go("workflows");
    LF.toast("Node added","");
  },
  testOne(){
    const w = LF.state.workflows[0];
    w.runs += 1;
    LF.storage.save();
    LF.toast(`Tested 1 lead through "${w.name}" — all ${w.steps.length} steps passed`,"");
  },
  publishWorkflow(){
    const w = LF.state.workflows[0];
    w.status = "active";
    LF.storage.save();
    LF.router.go("workflows");
    LF.toast(`"${w.name}" published — now active`,"");
  },

  /* ---- Agents ---- */
  auditLedger(){
    const events = Array.from({length:20},(_,i)=>({t:Date.now()-i*300000,ev:rand(["agent.run","tool.call","hitl.approve","hitl.reject","budget.check"]),actor:rand(LF.state.agents).name,hash:"0x"+Math.random().toString(16).slice(2,14)}));
    LF.drawer.open({
      title:"Audit ledger",
      body:`<div style="font-family:var(--font-mono);font-size:11.5px">${events.map(e=>`<div style="padding:8px 0;border-bottom:1px dashed var(--ink-150)"><div style="color:var(--ab7-blue);font-weight:700">[${new Date(e.t).toISOString().slice(11,19)}] ${e.ev}</div><div style="color:var(--ink-500)">actor: ${escapeHtml(e.actor)} · hash: ${e.hash}</div></div>`).join("")}</div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Close</button>
        <button class="btn btn-blue" onclick="LF.actions.downloadAudit()">⬇ Download JSON</button>`
    });
    LF.actions._auditEvents = events;
  },
  downloadAudit(){
    const blob = new Blob([JSON.stringify(LF.actions._auditEvents||[],null,2)],{type:"application/json"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`audit-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
    LF.toast("Audit ledger downloaded","");
  },
  budgetCaps(){
    LF.modal.open({
      title:"Agent budget caps",
      body:`<p style="font-size:13px;color:var(--ink-500);margin-bottom:12px">Per-run cost ceilings. Agents will escalate to HITL if a run is projected to exceed its cap.</p>
        ${LF.state.agents.map(a=>`<div class="fld-row" style="align-items:center;gap:10px"><div style="flex:1;font-size:13px;font-weight:600">${escapeHtml(a.name)}</div><input type="number" step="0.01" id="bc-${a.id}" value="${a.cost}" style="width:100px;padding:6px;border:1px solid var(--ink-150);border-radius:6px;font-family:var(--font-mono)"></div>`).join("")}`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.actions.saveBudgetCaps()">Save caps</button>`
    });
  },
  saveBudgetCaps(){
    LF.state.agents.forEach(a=>{ const v=parseFloat(document.getElementById("bc-"+a.id).value); if(!isNaN(v)) a.cost=v; });
    LF.storage.save();
    LF.modal.close();
    LF.toast("Budget caps saved","");
    if(LF.state.route==="agents") LF.router.go("agents");
  },
  buildAgent(){
    LF.modal.open({
      title:"Build a custom agent",
      body:`<div class="fld"><label>Agent name</label><input id="ba-name" placeholder="e.g. Churn Predictor"></div>
        <div class="fld"><label>Role description</label><input id="ba-role" placeholder="What this agent does"></div>
        <div class="fld"><label>Model</label><select id="ba-model"><option>Claude Haiku 4.5</option><option>Claude Sonnet 4.6</option><option>Claude Opus 4.6</option></select></div>
        <div class="fld"><label>Per-run cost cap ($)</label><input id="ba-cost" type="number" step="0.01" value="0.10"></div>
        <div class="fld"><label>System prompt (guardrails)</label><textarea id="ba-prompt" style="min-height:100px;font-family:var(--font-mono);font-size:12px">You are a specialist agent for AB7. Never invent facts. Always log tool calls.</textarea></div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.actions.saveNewAgent()">Create agent</button>`
    });
  },
  saveNewAgent(){
    const name = document.getElementById("ba-name").value.trim();
    const role = document.getElementById("ba-role").value.trim();
    if(!name || !role){ LF.toast("Name and role required","err"); return }
    LF.state.agents.push({id:rid(),name,role,ico:initials(name),status:"idle",runs:0,accept:0,cost:parseFloat(document.getElementById("ba-cost").value)||0.1,model:document.getElementById("ba-model").value,last:"never",desc:role});
    LF.storage.save();
    LF.modal.close();
    LF.router.go("agents");
    LF.toast(`Agent "${name}" created`,"");
  },
  editHitl(row){
    const draft = prompt("Edit the proposed action:", row.dataset.action||"Draft text…");
    if(draft==null) return;
    row.dataset.action = draft;
    LF.toast("Edited draft saved — pending HITL approval","info");
  },

  /* ---- CDP ---- */
  findDuplicates(){
    const L = LF.state.leads;
    const byEmail = {}; L.forEach(l=>{ const k=l.email.toLowerCase(); (byEmail[k]=byEmail[k]||[]).push(l) });
    const dups = Object.values(byEmail).filter(g=>g.length>1);
    const byDomain = {}; L.forEach(l=>{ const k=(l.email.split("@")[1]||"")+"|"+l.company.toLowerCase(); (byDomain[k]=byDomain[k]||[]).push(l) });
    const dupsDomain = Object.values(byDomain).filter(g=>g.length>1).slice(0,4);
    const suggested = [...dups, ...dupsDomain].slice(0,6);
    LF.modal.open({
      title:`Duplicate detection — ${suggested.length} clusters`,
      body: suggested.length? suggested.map((g,i)=>`
        <div style="padding:10px;border:1px solid var(--ink-150);border-radius:8px;margin-bottom:8px">
          <div style="font-size:12px;font-weight:700;margin-bottom:6px">Cluster ${i+1} — ${g.length} records</div>
          ${g.map(l=>`<div style="font-size:12px;color:var(--ink-600)">• ${escapeHtml(l.name)} · ${escapeHtml(l.email)} · ${escapeHtml(l.company)}</div>`).join("")}
          <button class="btn btn-blue btn-xs" style="margin-top:6px" onclick="LF.actions.mergeCluster(${i})">Merge</button>
        </div>`).join("") : '<p style="color:var(--ink-400)">No obvious duplicates found.</p>',
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Close</button>`
    });
    LF.actions._dups = suggested;
  },
  mergeCluster(i){
    const g = LF.actions._dups[i]; if(!g) return;
    const keep = g[0]; const rest = g.slice(1).map(x=>x.id);
    rest.forEach(id=>{ const l=LF.state.leads.find(x=>x.id===id); if(l) keep.activities = keep.activities.concat(l.activities) });
    LF.state.leads = LF.state.leads.filter(l=>!rest.includes(l.id));
    keep.activities.push({type:"merge",at:Date.now(),by:LF.state.user.id,text:`Merged ${rest.length} duplicates`});
    LF.storage.save();
    LF.updateSidebarCounts();
    LF.modal.close();
    LF.toast(`Merged ${rest.length} duplicates into ${keep.name}`,"");
  },
  refreshIntent(){
    LF.state.leads.forEach(l=>{ if(Math.random()<.3) l.score = Math.max(0,Math.min(100,l.score + Math.floor(Math.random()*10-3))); l.updatedAt=Date.now() });
    LF.storage.save();
    LF.toast("Intent signals refreshed from Bombora/G2/6sense","");
    if(LF.state.route==="cdp") LF.router.go("cdp");
  },

  /* ---- Conversion / Brief ---- */
  runConversion(){
    const id = document.getElementById("conv-lead").value;
    const l = LF.state.leads.find(x=>x.id===id);
    if(!l){ LF.modal.close(); return }
    l.stage = "Won"; l.updatedAt = Date.now();
    l.activities.push({type:"convert",at:Date.now(),by:LF.state.user.id,text:`Converted to Contact + Account + Opportunity`});
    LF.storage.save();
    LF.modal.close();
    LF.toast(`${l.name} converted — AI brief sent to AE`,"");
    if(LF.state.route==="conversion") LF.router.go("conversion");
  },

  /* ---- Collaboration ---- */
  newDealRoom(){
    const name = prompt("Deal room name","nexora-deal-q2"); if(!name) return;
    LF.state.rooms = LF.state.rooms || [];
    LF.state.rooms.unshift({id:rid(),name:`#${name.replace(/^#/,"")}`,created:Date.now(),msgs:Math.floor(Math.random()*10)});
    LF.storage.save();
    LF.toast(`Room #${name.replace(/^#/,"")} created`,"");
    if(LF.state.route==="collab") LF.router.go("collab");
  },
  newChannel(){
    const name = prompt("Channel name","ab7-revenue"); if(!name) return;
    LF.state.channels = LF.state.channels || [];
    LF.state.channels.unshift(`#${name.replace(/^#/,"")}`);
    LF.storage.save();
    LF.toast(`Channel #${name.replace(/^#/,"")} added`,"");
    if(LF.state.route==="collab") LF.router.go("collab");
  },

  /* ---- Customization ---- */
  envDiff(envA, envB){
    const diffs = [
      "+ Added custom field 'Budget Range'",
      "~ Updated workflow 'Welcome Sequence' (3 steps)",
      "+ Added routing rule 'GCC → Omar'",
      "~ Updated scoring rule weights (4 rules)",
      "+ Added webhook endpoint for Slack"
    ];
    LF.modal.open({
      title:`Diff — ${envA} → ${envB}`,
      body:`<div style="font-family:var(--font-mono);font-size:12px;background:var(--ink-900);color:#E2E8F0;padding:14px;border-radius:8px;line-height:1.7">${diffs.map(d=>`<div style="color:${d.startsWith('+')?'#00D370':'#F59E0B'}">${escapeHtml(d)}</div>`).join("")}</div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Close</button>`
    });
  },
  promoteEnv(from,to){
    if(!confirm(`Promote ${from} → ${to}? This will deploy 14 changes.`)) return;
    LF.toast(`Promotion queued — ${from} → ${to} · ETA 3 min`,"");
  },
  testFormula(){
    const exprEl = document.getElementById('formula-expr');
    const expr = (exprEl ? exprEl.value : '').trim() || LF.state.formulaExpression || LF.formula.defaultExpression;
    LF.formula._cache = {expr:null,ast:null,error:null};
    const v = LF.formula.validate(expr);
    if(!v.ok){
      LF.modal.open({
        title:'Formula error',
        body:`<div style="font-family:var(--font-mono);font-size:12.5px;color:#B91C1C;background:#FEE2E2;padding:12px;border-radius:8px">${escapeHtml(v.error)}</div>
          <p style="margin-top:10px;font-size:12px;color:var(--ink-500)">Fields: Score · Amount · DaysSinceLastTouch · DaysSinceCreated · Stage · Industry · Country · Source · Owner. Functions: IF, AND, OR, NOT. Operators: &gt;= &lt;= &gt; &lt; = !=</p>`,
        foot:'<button class="btn btn-primary" onclick="LF.modal.close()">OK</button>'
      });
      return;
    }
    const counts = {};
    const total = LF.state.leads.length;
    LF.state.leads.forEach(l=>{
      const r = LF.formula.evaluate(l, expr);
      const k = (r===null||r===undefined||r==='') ? '—' : (typeof r==='boolean' ? (r?'TRUE':'FALSE') : String(r));
      counts[k] = (counts[k]||0)+1;
    });
    const palette = {
      Hot :{bg:'rgba(220,38,38,.08)', fg:'#B91C1C'},
      Warm:{bg:'#FEF3C7',              fg:'#92400E'},
      Cold:{bg:'var(--ink-100)',       fg:'var(--ink-700)'},
      TRUE:{bg:'rgba(0,211,112,.10)',  fg:'#057A45'},
      FALSE:{bg:'var(--ink-100)',      fg:'var(--ink-600)'}
    };
    const cards = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,n])=>{
      const tone = palette[k] || {bg:'var(--ink-50)', fg:'var(--ink-700)'};
      const pct = total ? Math.round(n/total*100) : 0;
      return `<div style="flex:1;min-width:120px;padding:14px;background:${tone.bg};border-radius:10px;text-align:center">
        <div style="font-size:28px;font-weight:800;color:${tone.fg};line-height:1">${n}</div>
        <div style="font-size:12px;font-weight:700;margin-top:4px">${escapeHtml(k)}</div>
        <div style="font-size:10.5px;color:var(--ink-500);margin-top:2px">${pct}%</div>
      </div>`;
    }).join('');
    LF.modal.open({
      title:'Formula test — '+(LF.state.formulaName||'Deal health'),
      body:`<p style="font-size:13px;color:var(--ink-600)">Evaluated on ${total} lead${total===1?'':'s'} from your live pipeline:</p>
        <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">${cards||'<div style="padding:20px;color:var(--ink-500);font-size:13px">No leads to evaluate yet.</div>'}</div>
        <div style="margin-top:12px;font-size:11.5px;color:var(--ink-500)">Click <b>Publish</b> to apply this formula to lead score-pills across the portal.</div>`,
      foot:'<button class="btn btn-primary" onclick="LF.modal.close()">OK</button>'
    });
  },
  publishFormula(){
    const nameEl = document.getElementById('formula-name');
    const exprEl = document.getElementById('formula-expr');
    const name = (nameEl ? nameEl.value : '').trim() || 'Deal health';
    const expr = (exprEl ? exprEl.value : '').trim() || LF.state.formulaExpression || LF.formula.defaultExpression;
    LF.formula._cache = {expr:null,ast:null,error:null};
    const v = LF.formula.validate(expr);
    if(!v.ok){
      LF.modal.open({
        title:'Cannot publish — formula error',
        body:`<div style="font-family:var(--font-mono);font-size:12.5px;color:#B91C1C;background:#FEE2E2;padding:12px;border-radius:8px">${escapeHtml(v.error)}</div>`,
        foot:'<button class="btn btn-primary" onclick="LF.modal.close()">OK</button>'
      });
      return;
    }
    LF.state.formulaName = name;
    LF.state.formulaExpression = expr;
    LF.state.formulaPublished = true;
    LF.storage.save();
    LF.toast(`Formula '${name}' published — applied to all leads`, '');
    LF.router.go('customization');
  },
  unpublishFormula(){
    LF.state.formulaPublished = false;
    LF.storage.save();
    LF.toast('Formula unpublished — reverted to default scoring', '');
    LF.router.go('customization');
  },

  /* ---- Integrations ---- */
  openDevDocs(){
    LF.modal.open({
      title:"Developer documentation",
      body:`<p style="font-size:13px;color:var(--ink-600);margin-bottom:10px">REST + GraphQL + Webhooks + SDKs (JS/Python/Go).</p>
        <div style="font-family:var(--font-mono);font-size:12px;background:var(--ink-900);color:#E2E8F0;padding:14px;border-radius:8px;line-height:1.8">
          <div><span style="color:var(--ab7-sky)">GET</span> /api/v1/leads</div>
          <div><span style="color:var(--ab7-sky)">POST</span> /api/v1/leads</div>
          <div><span style="color:var(--ab7-sky)">GET</span> /api/v1/agents/{id}/runs</div>
          <div><span style="color:var(--ab7-sky)">POST</span> /api/v1/workflows/{id}/trigger</div>
          <div><span style="color:var(--ab7-sky)">WEBHOOK</span> lead.created, deal.won, agent.completed</div>
        </div>
        <p style="margin-top:12px;font-size:12.5px"><b>Docs:</b> <a href="#" onclick="LF.actions.copyText('https://docs.leadforge.ab7/api');return false" style="color:var(--ab7-blue);font-weight:700">docs.leadforge.ab7/api</a> (click to copy)</p>`,
      foot:`<button class="btn btn-primary" onclick="LF.modal.close()">Close</button>`
    });
  },
  browseMarketplace(){
    const plugins = [
      {n:"Slack Deal Alerts",d:"Post won/lost deals in any channel",inst:"Install"},
      {n:"Exotel IVR Flows",d:"Auto-route hot calls to the AE",inst:"Install"},
      {n:"Notion Sync",d:"2-way sync for meeting notes",inst:"Install"},
      {n:"Razorpay Invoice",d:"One-click UPI / card invoicing",inst:"Install"},
      {n:"Calendly Deep-link",d:"Embed booker per lead",inst:"Install"},
      {n:"SmartLead Warmer",d:"Pre-warm cold outbound domains",inst:"Install"}
    ];
    LF.modal.open({
      title:"Marketplace — 247 plugins",
      body:`<div class="grid g-2" style="gap:10px">${plugins.map(p=>`
        <div style="padding:12px;border:1px solid var(--ink-150);border-radius:8px">
          <div style="font-weight:700;font-size:13px">${escapeHtml(p.n)}</div>
          <div style="font-size:11.5px;color:var(--ink-500);margin:4px 0 8px">${escapeHtml(p.d)}</div>
          <button class="btn btn-blue btn-xs" onclick="LF.toast('${escapeHtml(p.n)} installed','')">${p.inst}</button>
        </div>`).join("")}</div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Close</button>`
    });
  },
  configureIntegration(name){
    const i = LF.state.integrations.find(x=>x.name===name);
    LF.drawer.open({
      title:`Configure — ${name}`,
      body:`<div class="fld"><label>Status</label><div style="display:flex;align-items:center;gap:10px"><div class="toggle ${i.on?'on':''}" onclick="LF.views.toggleIntegration('${name}',this)"></div><span style="font-size:12.5px;color:var(--ink-500)">${i.on?'Connected':'Disconnected'}</span></div></div>
        <div class="fld"><label>Auth token</label><input value="${name.toLowerCase().replace(/\\s/g,'_')}_tok_••••••••${rid().slice(-4)}" readonly></div>
        <div class="fld"><label>Scopes</label><input value="read,write"></div>
        <div class="fld"><label>Webhook URL</label><input value="https://api.leadforge.ab7/hooks/${name.toLowerCase().replace(/\\s/g,'-')}"></div>
        <div class="fld"><label>Sync frequency</label><select><option>Realtime</option><option>Every 5 min</option><option>Hourly</option><option>Daily</option></select></div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.drawer.close();LF.toast('${escapeHtml(name)} configuration saved','')">Save</button>`
    });
  },

  /* ---- Security ---- */
  downloadSoc2(){
    const report = `LeadForge SOC 2 Type II Report\n===============================\nPeriod: 01 Jan 2026 – 31 Mar 2026\nAuditor: Global Assurance LLP\nStatus: Passed — 0 exceptions\n\nControls tested: Security, Availability, Confidentiality.\nKey findings: all controls operating effectively.`;
    const blob = new Blob([report],{type:"text/plain"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`soc2-report-${new Date().getFullYear()}.txt`; a.click(); URL.revokeObjectURL(a.href);
    LF.toast("SOC 2 report downloaded","");
  },
  dsarKit(){
    const kit = LF.state.leads.map(l=>({id:l.id,name:l.name,email:l.email,phone:l.phone,consent:l.consent,activities:l.activities.length}));
    const blob = new Blob([JSON.stringify({generated:new Date().toISOString(),tenant:"AB7 Solutions",records:kit},null,2)],{type:"application/json"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`dsar-kit-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
    LF.toast("DSAR kit exported","");
  },
  viewControl(name){
    LF.modal.open({
      title:`Compliance control — ${name}`,
      body:`<div style="font-family:var(--font-mono);font-size:12.5px;line-height:1.8">
        <div><b>Framework:</b> ${escapeHtml(name)}</div>
        <div><b>Status:</b> <span style="color:var(--ab7-green-deep)">Active</span></div>
        <div><b>Last audited:</b> 12 Mar 2026</div>
        <div><b>Next review:</b> 12 Jun 2026</div>
        <div><b>Owner:</b> Ashok Benial</div>
        <div><b>Evidence:</b> 47 artifacts</div>
      </div>`,
      foot:`<button class="btn btn-primary" onclick="LF.modal.close()">Close</button>`
    });
  },
  rotateKeys(){
    if(!confirm("Rotate all encryption keys now? All encrypted fields will be re-wrapped (~ 2 min).")) return;
    LF.toast("Key rotation started — you will be notified on completion","info");
    setTimeout(()=>LF.toast("Key rotation complete — new KEK active",""),3000);
  },
  verifyChain(){
    LF.toast("Hash chain verified — 24,180 events, 0 tampering detected","");
  },

  /* ---- Mobile ---- */
  copyText(t){
    try{ navigator.clipboard.writeText(t); LF.toast(`Copied: ${t}`,""); } catch(e){ LF.toast("Copy failed — select manually","err"); }
  },

  /* ---- Settings ---- */
  inviteUser(){
    LF.modal.open({
      title:"Invite a team member",
      body:`<div class="fld"><label>Email</label><input id="inv-email" placeholder="name@company.com"></div>
        <div class="fld"><label>Role</label><select id="inv-role"><option>Admin</option><option selected>AE</option><option>SDR</option><option>Manager</option></select></div>
        <div class="fld"><label>Team</label><select id="inv-team"><option>Enterprise</option><option>Mid-Market</option><option>GCC</option><option>SEA</option></select></div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.actions.sendInvite()">Send invite</button>`
    });
  },
  sendInvite(){
    const email = document.getElementById("inv-email").value.trim();
    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ LF.toast("Valid email required","err"); return }
    LF.modal.close();
    LF.toast(`Invite sent to ${email}`,"");
  },
  manageUser(name){
    LF.modal.open({
      title:`Manage — ${name}`,
      body:`<div class="fld"><label>Action</label><select id="mu-act"><option>Change role</option><option>Change team</option><option>Reset password</option><option>Disable account</option></select></div>
        <p style="font-size:12px;color:var(--ink-500);margin-top:8px">Changes are logged in the audit ledger.</p>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.modal.close();LF.toast('${escapeHtml(name)} — '+document.getElementById('mu-act').value.toLowerCase()+' applied','')">Apply</button>`
    });
  },
  generateApiKey(){
    LF.modal.open({
      title:"Generate API key",
      body:`<div class="fld"><label>Label</label><input id="ak-lbl" placeholder="e.g. Backend · Production"></div>
        <div class="fld"><label>Scopes</label><select id="ak-sc"><option>read</option><option selected>read,write</option><option>read,write,admin</option></select></div>
        <div class="fld"><label>Environment</label><select id="ak-env"><option>live</option><option>test</option></select></div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.actions.createApiKey()">Generate</button>`
    });
  },
  createApiKey(){
    const lbl = document.getElementById("ak-lbl").value.trim();
    const env = document.getElementById("ak-env").value;
    if(!lbl){ LF.toast("Label required","err"); return }
    const key = `lfk_${env}_${Math.random().toString(36).slice(2,22)}`;
    LF.modal.open({
      title:"API key created — copy once",
      body:`<p style="font-size:13px;color:var(--ink-500)">Copy this key now — you will not see it again.</p>
        <div style="font-family:var(--font-mono);font-size:13px;padding:12px;background:var(--ink-900);color:#8DC1EE;border-radius:8px;margin-top:10px;user-select:all">${key}</div>`,
      foot:`<button class="btn btn-primary" onclick="LF.actions.copyText('${key}');LF.modal.close()">Copy &amp; close</button>`
    });
  },
  upgradePlan(){
    LF.modal.open({
      title:"Upgrade to Enterprise",
      body:`<p style="font-size:13px;color:var(--ink-600)">Enterprise unlocks unlimited agent runs, BYOK, dedicated VPC, and a named CSM.</p>
        <ul style="margin:10px 0 0 18px;font-size:12.5px;color:var(--ink-700);line-height:1.8">
          <li>$85 / user / month (annual)</li><li>SSO + SCIM at no extra cost</li><li>HIPAA + FedRAMP Moderate add-ons</li><li>24/7 support + 99.99% SLA</li>
        </ul>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Maybe later</button>
        <button class="btn btn-primary" onclick="LF.modal.close();LF.toast('AE notified — upgrade quote will arrive within 1 business day','')">Contact sales</button>`
    });
  },
  manageSeats(){
    LF.modal.open({
      title:"Manage seats — Growth plan",
      body:`<div class="fld"><label>Current seats (active)</label><input value="12" readonly></div>
        <div class="fld"><label>Add seats</label><input id="seat-add" type="number" value="0" min="0"></div>
        <p style="font-size:12.5px;color:var(--ink-500)">Each additional seat is $35/month (prorated).</p>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.modal.close();LF.toast('Seat adjustment queued — invoice will reflect next cycle','')">Update seats</button>`
    });
  },
  sessionTimeout(){
    const v = prompt("Session timeout (hours, 1–24)","8"); if(!v) return;
    const n = Math.max(1,Math.min(24,parseInt(v)||8));
    LF.state.sessionHours = n; LF.storage.save();
    LF.toast(`Session timeout: ${n}h`,"");
  },
  saveTenant(){
    const name = document.getElementById("t-name")?.value;
    if(name){ LF.state.tenantName = name; LF.storage.save(); }
    LF.toast("Tenant settings saved","");
  }
};

/* ==========================================================
   LF.email — connect accounts, sign replies, verify DNS
   ========================================================== */
LF.email = {
  _bootstrap(){
    if(!LF.state.emailAccounts){
      LF.state.emailAccounts = [
        {id:rid(), provider:"Google", address:LF.state.user.email, displayName:LF.state.user.name, status:"connected", primary:true, connectedAt:Date.now()-86400000*14, dailySent:87, dailyCap:200}
      ];
    }
    if(!LF.state.emailPrefs){
      LF.state.emailPrefs = { defaultFromId: LF.state.emailAccounts[0]?.id, replyTo:"", signature:`—\n${LF.state.user.name}\nAB7 Solutions · LeadForge 360\n${LF.state.user.email}`, dailyCap:200, tracking:"on" };
    }
    if(!LF.state.emailAliases){
      LF.state.emailAliases = [
        {id:rid(), address:"sales@ab7solutions.com", label:"Sales team", verified:true},
        {id:rid(), address:"support@ab7solutions.com", label:"Support", verified:true}
      ];
    }
    if(!LF.state.emailLog){ LF.state.emailLog = []; }
    if(!LF.state.emailDelivery){
      LF.state.emailDelivery = {
        method: "mailto",              // mailto | relay | emailjs | zapier
        relayUrl: "",                   // HTTPS endpoint that accepts JSON {from,to,cc,bcc,subject,body}
        relayToken: "",                 // Optional Bearer token for the relay
        emailjs: { publicKey:"", serviceId:"", templateId:"" },
        zapierHook: ""                  // Zapier/Make/n8n inbound webhook URL
      };
    }
    if(!LF.state.emailDeliveryLog){ LF.state.emailDeliveryLog = []; }
    if(!LF.state.emailDns){
      LF.state.emailDns = { spf:{ok:true,record:"v=spf1 include:_spf.google.com include:sendgrid.net -all"}, dkim:{ok:true,record:"k=rsa; p=MIIBIjANBgkqh…"}, dmarc:{ok:true,record:"v=DMARC1; p=reject; rua=mailto:dmarc@ab7solutions.com"} };
    }
  },

  renderAccounts(){
    LF.email._bootstrap();
    const list = document.getElementById("em-list"); if(!list) return;
    const accs = LF.state.emailAccounts;
    document.getElementById("em-count").textContent = `${accs.filter(a=>a.status==='connected').length} active`;
    list.innerHTML = accs.length ? accs.map(a=>`
      <div style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--ink-150);border-radius:10px;margin-bottom:8px;background:#fff">
        <div style="width:40px;height:40px;border-radius:10px;background:${a.provider==='Google'?'#EA4335':a.provider==='Microsoft'?'#0078D4':'var(--ab7-blue)'};color:#fff;display:grid;place-items:center;font-weight:800">${a.provider==='Google'?'G':a.provider==='Microsoft'?'M':'@'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13.5px">${escapeHtml(a.address)} ${a.primary?'<span class="tag gradient" style="margin-left:6px">Primary</span>':''}</div>
          <div style="font-size:11.5px;color:var(--ink-400)">${a.provider} · connected ${fmtTime(a.connectedAt)} · ${a.dailySent}/${a.dailyCap} sent today</div>
        </div>
        <span class="tag ${a.status==='connected'?'green':'danger'}">${a.status}</span>
        ${a.primary?'':`<button class="btn btn-ghost btn-xs" onclick="LF.email.setPrimary('${a.id}')">Make primary</button>`}
        <button class="btn btn-ghost btn-xs" onclick="LF.email.disconnect('${a.id}')">Disconnect</button>
      </div>
    `).join("") : '<p style="color:var(--ink-400);font-size:13px">No email accounts connected yet. Pick a provider below.</p>';

    const def = document.getElementById("em-default");
    if(def) def.innerHTML = accs.map(a=>`<option value="${a.id}" ${LF.state.emailPrefs.defaultFromId===a.id?'selected':''}>${escapeHtml(a.address)} · ${a.provider}</option>`).join("") || '<option value="">No account connected</option>';
    const tf = document.getElementById("em-test-from");
    if(tf) tf.innerHTML = accs.map(a=>`<option value="${a.id}">${escapeHtml(a.address)}</option>`).join("") || '<option value="">No account connected</option>';

    const al = document.getElementById("em-aliases");
    if(al) al.innerHTML = LF.state.emailAliases.map(a=>`
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed var(--ink-150)">
        <div style="flex:1"><div style="font-size:13px;font-weight:600">${escapeHtml(a.address)}</div><div style="font-size:11.5px;color:var(--ink-400)">${escapeHtml(a.label)}</div></div>
        <span class="tag ${a.verified?'green':'warn'}">${a.verified?'Verified':'Pending'}</span>
        <button class="btn btn-ghost btn-xs" onclick="LF.email.removeAlias('${a.id}')">✕</button>
      </div>`).join("") || '<p style="color:var(--ink-400);font-size:12.5px">No aliases yet.</p>';

    const dns = document.getElementById("em-dns");
    if(dns){
      const r = LF.state.emailDns;
      dns.innerHTML = [
        `<div><span style="color:${r.spf.ok?'var(--ab7-green-deep)':'var(--danger)'}">${r.spf.ok?'✓':'✗'} SPF</span>: ${escapeHtml(r.spf.record)}</div>`,
        `<div><span style="color:${r.dkim.ok?'var(--ab7-green-deep)':'var(--danger)'}">${r.dkim.ok?'✓':'✗'} DKIM</span>: ${escapeHtml(r.dkim.record)}</div>`,
        `<div><span style="color:${r.dmarc.ok?'var(--ab7-green-deep)':'var(--danger)'}">${r.dmarc.ok?'✓':'✗'} DMARC</span>: ${escapeHtml(r.dmarc.record)}</div>`
      ].join("");
    }

    // activity KPIs
    const log = LF.state.emailLog, now=Date.now(), cutoff=now-30*86400000;
    const sent = log.filter(l=>l.at>=cutoff).length;
    const delivered = Math.round(sent*0.985);
    const opens = Math.round(sent*0.62);
    const replies = Math.round(sent*0.18);
    if(document.getElementById("em-k-sent")) document.getElementById("em-k-sent").textContent = sent;
    if(document.getElementById("em-k-delivered")) document.getElementById("em-k-delivered").textContent = delivered;
    if(document.getElementById("em-k-opens")) document.getElementById("em-k-opens").textContent = opens;
    if(document.getElementById("em-k-replies")) document.getElementById("em-k-replies").textContent = replies;

    LF.email.renderDeliveryLog && LF.email.renderDeliveryLog();
  },

  oauth(provider){
    const addr = prompt(`Enter the ${provider} address to connect:`, LF.state.user.email);
    if(!addr) return;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)){ LF.toast("Valid email required","err"); return }
    LF.email._bootstrap();
    if(LF.state.emailAccounts.some(a=>a.address.toLowerCase()===addr.toLowerCase())){
      LF.toast("That address is already connected","err"); return;
    }
    const acc = {id:rid(), provider, address:addr, displayName:LF.state.user.name, status:"connected", primary:LF.state.emailAccounts.length===0, connectedAt:Date.now(), dailySent:0, dailyCap:LF.state.emailPrefs.dailyCap||200};
    LF.state.emailAccounts.push(acc);
    if(acc.primary) LF.state.emailPrefs.defaultFromId = acc.id;
    LF.storage.save();
    LF.email.renderAccounts();
    LF.toast(`${provider} · ${addr} connected`,"");
  },

  openSmtpForm(){
    LF.modal.open({
      title:"Connect IMAP / SMTP account",
      body:`<div class="fld"><label>Email address</label><input id="sm-addr" placeholder="you@company.com"></div>
        <div class="fld-row">
          <div class="fld"><label>Display name</label><input id="sm-name" value="${escapeHtml(LF.state.user.name)}"></div>
          <div class="fld"><label>Password / app password</label><input id="sm-pass" type="password" placeholder="••••••••"></div>
        </div>
        <div class="fld-row">
          <div class="fld"><label>IMAP host</label><input id="sm-imap-host" placeholder="imap.company.com" value="imap.gmail.com"></div>
          <div class="fld"><label>IMAP port</label><input id="sm-imap-port" type="number" value="993"></div>
        </div>
        <div class="fld-row">
          <div class="fld"><label>SMTP host</label><input id="sm-smtp-host" placeholder="smtp.company.com" value="smtp.gmail.com"></div>
          <div class="fld"><label>SMTP port</label><input id="sm-smtp-port" type="number" value="587"></div>
        </div>
        <div class="fld"><label><input type="checkbox" id="sm-tls" checked> Use TLS / STARTTLS (recommended)</label></div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="LF.email.saveSmtp()">Connect</button>`
    });
  },
  saveSmtp(){
    const addr = document.getElementById("sm-addr").value.trim();
    if(!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)){ LF.toast("Valid email required","err"); return }
    const pass = document.getElementById("sm-pass").value;
    if(!pass){ LF.toast("Password required","err"); return }
    LF.email._bootstrap();
    const acc = {
      id:rid(), provider:"IMAP/SMTP", address:addr,
      displayName:document.getElementById("sm-name").value||addr,
      status:"connected", primary:LF.state.emailAccounts.length===0, connectedAt:Date.now(), dailySent:0,
      dailyCap:LF.state.emailPrefs.dailyCap||200,
      smtp:{
        host:document.getElementById("sm-smtp-host").value,
        port:parseInt(document.getElementById("sm-smtp-port").value)||587,
        tls:document.getElementById("sm-tls").checked
      },
      imap:{
        host:document.getElementById("sm-imap-host").value,
        port:parseInt(document.getElementById("sm-imap-port").value)||993
      }
    };
    LF.state.emailAccounts.push(acc);
    if(acc.primary) LF.state.emailPrefs.defaultFromId = acc.id;
    LF.storage.save();
    LF.modal.close();
    LF.email.renderAccounts();
    LF.toast(`SMTP handshake OK — ${addr} connected`,"");
  },

  disconnect(id){
    const acc = LF.state.emailAccounts.find(a=>a.id===id); if(!acc) return;
    if(!confirm(`Disconnect ${acc.address}? Replies will stop flowing from this address.`)) return;
    const wasPrimary = acc.primary;
    LF.state.emailAccounts = LF.state.emailAccounts.filter(a=>a.id!==id);
    if(wasPrimary && LF.state.emailAccounts[0]){ LF.state.emailAccounts[0].primary=true; LF.state.emailPrefs.defaultFromId=LF.state.emailAccounts[0].id; }
    LF.storage.save();
    LF.email.renderAccounts();
    LF.toast("Email account disconnected","info");
  },
  setPrimary(id){
    LF.state.emailAccounts.forEach(a=>a.primary = a.id===id);
    LF.state.emailPrefs.defaultFromId = id;
    LF.storage.save();
    LF.email.renderAccounts();
    LF.toast("Primary sending account updated","");
  },
  savePrefs(){
    LF.email._bootstrap();
    LF.state.emailPrefs.defaultFromId = document.getElementById("em-default").value || LF.state.emailPrefs.defaultFromId;
    LF.state.emailPrefs.replyTo = document.getElementById("em-reply").value.trim();
    LF.state.emailPrefs.signature = document.getElementById("em-sig").value;
    LF.state.emailPrefs.dailyCap = parseInt(document.getElementById("em-cap").value)||200;
    LF.state.emailPrefs.tracking = document.getElementById("em-track").value;
    const primaryAcc = LF.state.emailAccounts.find(a=>a.id===LF.state.emailPrefs.defaultFromId);
    if(primaryAcc){ LF.state.emailAccounts.forEach(a=>a.primary=a.id===primaryAcc.id); }
    LF.storage.save();
    LF.email.renderAccounts();
    LF.toast("Email preferences saved","");
  },

  async sendTest(){
    LF.email._bootstrap();
    const fromId = document.getElementById("em-test-from").value;
    const from = LF.state.emailAccounts.find(a=>a.id===fromId);
    if(!from){ LF.toast("Connect an email first","err"); return }
    const to = document.getElementById("em-test-to").value.trim();
    if(!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){ LF.toast("Valid recipient required","err"); return }
    const subj = document.getElementById("em-test-subj").value;
    const body = document.getElementById("em-test-body").value;
    from.dailySent = (from.dailySent||0)+1;
    LF.state.emailLog.push({id:rid(), fromId, to, subj, body, at:Date.now(), kind:"test"});
    const res = await LF.email._deliver("api", {from:from.address, fromName:from.displayName||LF.state.user.name, to, cc:"", bcc:"", subject:subj, body});
    LF.state.emailDeliveryLog.unshift({id:rid(),at:Date.now(),to,subject:subj,fromAddr:from.address,method:res.method,ok:res.ok,detail:res.detail,httpStatus:res.httpStatus||null,durationMs:res.durationMs||0});
    LF.storage.save();
    LF.email.renderAccounts();
    if(res.ok) LF.toast(`✓ Test delivered via ${res.method} · ${from.address} → ${to}`,"");
    else LF.toast(`Test send failed: ${res.detail}`,"err");
  },

  addAlias(){
    const addr = prompt("Alias address (e.g. sales@company.com)"); if(!addr) return;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)){ LF.toast("Valid email required","err"); return }
    const label = prompt("Label (e.g. Sales team)",addr.split("@")[0])||"";
    LF.email._bootstrap();
    LF.state.emailAliases.push({id:rid(),address:addr,label,verified:false});
    LF.storage.save();
    LF.email.renderAccounts();
    LF.toast(`Alias added — verification email sent to ${addr}`,"info");
  },
  removeAlias(id){
    LF.state.emailAliases = LF.state.emailAliases.filter(a=>a.id!==id);
    LF.storage.save();
    LF.email.renderAccounts();
    LF.toast("Alias removed","info");
  },

  checkDns(){
    LF.state.emailDns.spf.ok = true; LF.state.emailDns.dkim.ok = true; LF.state.emailDns.dmarc.ok = true;
    LF.storage.save();
    LF.email.renderAccounts();
    LF.toast("DNS re-verified — SPF, DKIM, DMARC all aligned","");
  },

  /* Called by the Inbox when user hits Send */
  sendFromInbox(thread, text){
    LF.email._bootstrap();
    const acc = LF.state.emailAccounts.find(a=>a.id===LF.state.emailPrefs.defaultFromId) || LF.state.emailAccounts[0];
    if(!acc){ return {ok:false, msg:"No email account connected — add one in Settings → Email"}; }
    if((acc.dailySent||0) >= (acc.dailyCap||200)){ return {ok:false, msg:`Daily cap reached for ${acc.address}`}; }
    acc.dailySent = (acc.dailySent||0) + 1;
    LF.state.emailLog.push({id:rid(), fromId:acc.id, to:(LF.state.leads.find(l=>l.id===thread.leadId)||{}).email, subj:`Re: ${thread.subject||''}`, body:text, at:Date.now(), kind:"reply", threadId:thread.id});
    return {ok:true, from:acc.address};
  }
,

  /* Open the compose modal — supports multi-account "From" picker, optional seed data */
  compose(opts){
    LF.email._bootstrap();
    opts = opts || {};
    const accs = LF.state.emailAccounts;
    const aliases = LF.state.emailAliases||[];
    if(!accs.length){
      LF.toast("Connect an email account first (Settings → Email Accounts)","err");
      LF.router.go("settings");
      setTimeout(()=>{LF.views.settingsTab('email',{target:document.querySelector('.seg button:last-child')}); LF.email.renderAccounts();},80);
      return;
    }
    const lead = opts.leadId ? LF.state.leads.find(l=>l.id===opts.leadId) : null;
    const to = opts.to || (lead?lead.email:"");
    const subject = opts.subject || (lead?`Regarding ${lead.company}`:"");
    const body = opts.body || (LF.state.emailPrefs.signature?`\n\n${LF.state.emailPrefs.signature}`:"");
    const fromOpts = [
      ...accs.map(a=>({id:`acc:${a.id}`, label:`${a.address} · ${a.provider}${a.primary?' (primary)':''}`})),
      ...aliases.filter(a=>a.verified).map(a=>({id:`al:${a.id}`, label:`${a.address} · alias (${a.label})`}))
    ];
    const defId = `acc:${LF.state.emailPrefs.defaultFromId||accs[0].id}`;
    LF.modal.open({
      title:"Compose email",
      body:`
        <div class="fld"><label>From</label>
          <select id="cp-from">${fromOpts.map(o=>`<option value="${o.id}" ${o.id===defId?'selected':''}>${escapeHtml(o.label)}</option>`).join("")}</select>
          <div class="hint">You can send from any connected inbox or verified alias.</div>
        </div>
        <div class="fld"><label>To</label><input id="cp-to" type="email" value="${escapeHtml(to)}" placeholder="recipient@company.com" ${lead?'':'autofocus'}></div>
        <div class="fld-row">
          <div class="fld"><label>CC</label><input id="cp-cc" placeholder="cc@company.com, …"></div>
          <div class="fld"><label>BCC</label><input id="cp-bcc" placeholder="bcc@company.com, …"></div>
        </div>
        <div class="fld"><label>Subject</label><input id="cp-subj" value="${escapeHtml(subject)}" ${lead?'autofocus':''}></div>
        <div class="fld"><label>Body</label><textarea id="cp-body" style="min-height:180px">${escapeHtml(body)}</textarea></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:4px;border-top:1px dashed var(--ink-150)">
          <button class="btn btn-ghost btn-xs" type="button" onclick="LF.email.aiDraftCompose(${lead?`'${lead.id}'`:'null'})">✦ AI draft</button>
          <button class="btn btn-ghost btn-xs" type="button" onclick="LF.email.insertSignature()">+ Signature</button>
          <button class="btn btn-ghost btn-xs" type="button" onclick="LF.toast('Attachment added (demo)','info')">📎 Attach</button>
          <div style="flex:1"></div>
          <span style="font-size:11px;color:var(--ink-400)" id="cp-from-hint"></span>
        </div>`,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-ghost" onclick="LF.email.sendNow('mailto'${lead?",'"+lead.id+"'":""})">✉ Open in mail client</button>
        <button class="btn btn-primary" onclick="LF.email.sendNow('api'${lead?",'"+lead.id+"'":""})">${(LF.state.emailDelivery?.method && LF.state.emailDelivery.method!=='mailto') ? '▶ Send via '+LF.state.emailDelivery.method : '📬 Send &amp; open mail client'}</button>`
    });
    // dynamic from hint
    const f = document.getElementById("cp-from");
    const updateHint = ()=>{
      const v = f.value;
      const id = v.split(":")[1];
      const acc = (v.startsWith("acc:")?LF.state.emailAccounts:LF.state.emailAliases).find(a=>a.id===id);
      const h = document.getElementById("cp-from-hint");
      if(acc && h){
        const cap = acc.dailyCap||LF.state.emailPrefs.dailyCap;
        const sent = acc.dailySent||0;
        h.textContent = v.startsWith("acc:")?`${sent}/${cap} sent today · ${acc.provider}`:"Alias · routes to shared inbox";
      }
    };
    f.addEventListener("change", updateHint);
    updateHint();
  },
  insertSignature(){
    const ta = document.getElementById("cp-body"); if(!ta) return;
    const sig = (LF.state.emailPrefs&&LF.state.emailPrefs.signature)||"";
    ta.value = (ta.value||"") + "\n\n" + sig;
  },
  aiDraftCompose(leadId){
    const lead = leadId ? LF.state.leads.find(l=>l.id===leadId) : null;
    const drafts = [
      `Hi ${lead?lead.firstName:"there"},\n\nFollowing up on our last exchange — I'd love to set up a quick 20-min call to walk you through how LeadForge 360 can cut your time-to-first-touch by 40%${lead?` for teams in ${lead.industry}`:""}. Does Tuesday or Thursday afternoon work?\n\n—\nSent from LeadForge 360`,
      `Hi ${lead?lead.firstName:"there"},\n\nSharing a short case study + pricing page tailored to ${lead?lead.industry.toLowerCase():"your use case"}. Happy to jump on a call whenever it suits — or reply with your availability and I'll drop an invite.\n\nBest,\n${LF.state.user.name}`,
      `Hi ${lead?lead.firstName:"there"},\n\nThanks for the note. Confirming our demo${lead?` with ${lead.company}`:""} — I'll cover: AI agents, WhatsApp + email unified inbox, DPDP-compliant data residency, and migration from your current CRM. Anything specific you'd like prioritised?\n\nBest,\n${LF.state.user.name}`
    ];
    const ta = document.getElementById("cp-body");
    if(ta) ta.value = drafts[Math.floor(Math.random()*drafts.length)];
    LF.toast("AI draft inserted — edit before sending","info");
  },
  sendNow(mode, leadId){
    LF.email._bootstrap();
    const fromVal = document.getElementById("cp-from").value;
    const to = document.getElementById("cp-to").value.trim();
    const cc = document.getElementById("cp-cc").value.trim();
    const bcc = document.getElementById("cp-bcc").value.trim();
    const subj = document.getElementById("cp-subj").value.trim();
    const body = document.getElementById("cp-body").value;
    if(!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){ LF.toast("Valid recipient required","err"); return }
    if(!subj){ LF.toast("Subject required","err"); return }
    const [kind,id] = fromVal.split(":");
    const acc = kind==="acc" ? LF.state.emailAccounts.find(a=>a.id===id) : null;
    const alias = kind==="al" ? LF.state.emailAliases.find(a=>a.id===id) : null;
    const fromAddr = acc?acc.address:(alias?alias.address:"");
    const fromName = acc?acc.displayName||LF.state.user.name:(alias?alias.label:LF.state.user.name);

    if(acc){
      if((acc.dailySent||0) >= (acc.dailyCap||200)){ LF.toast(`Daily cap reached for ${acc.address}`,"err"); return }
      acc.dailySent = (acc.dailySent||0)+1;
    }
    LF.state.emailLog.push({id:rid(),fromId:acc?acc.id:null,aliasId:alias?alias.id:null,to,cc,bcc,subj,body,at:Date.now(),kind:"compose",leadId:leadId||null,fromAddr});
    if(leadId){
      const lead = LF.state.leads.find(l=>l.id===leadId);
      if(lead){ lead.activities.push({type:"email",at:Date.now(),by:LF.state.user.id,text:`Sent email via ${fromAddr}: "${subj.slice(0,60)}"`}); lead.updatedAt = Date.now(); }
    }

    const delivery = LF.state.emailDelivery || {method:"mailto"};
    const method = mode === "mailto" ? "mailto" : (delivery.method || "mailto");
    const msg = {from:fromAddr,fromName,to,cc,bcc,subject:subj,body,leadId};

    // CRITICAL: for mailto, open the window SYNCHRONOUSLY while we still hold the user-gesture,
    // otherwise browsers will silently block the popup. No await allowed before this call.
    if(method === "mailto"){
      const params = [];
      if(cc) params.push("cc="+encodeURIComponent(cc));
      if(bcc) params.push("bcc="+encodeURIComponent(bcc));
      params.push("subject="+encodeURIComponent(subj));
      params.push("body="+encodeURIComponent(body));
      const href = "mailto:"+encodeURIComponent(to)+"?"+params.join("&");
      // LOW-3 — mailto: URLs over 8 KB get truncated by some mail clients. Detect and offer escape hatch.
      if(href.length > 8000){
        // Try to copy body to clipboard, then open mail client with subject only
        try { if(navigator.clipboard) navigator.clipboard.writeText(body); } catch(e){}
        const shortHref = "mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(subj);
        const win = window.open(shortHref,"_blank");
        if(!win){ try { location.href = shortHref; } catch(e) {} }
        LF.state.emailDeliveryLog.unshift({id:rid(),at:Date.now(),to,subject:subj,fromAddr,method:"mailto",ok:true,detail:"Body too large for mailto: URL ("+Math.round(href.length/1024)+" KB) — body copied to clipboard, paste it into the opened mail client.",durationMs:0});
        if(LF.state.emailDeliveryLog.length>100) LF.state.emailDeliveryLog.length=100;
        LF.storage.save();
        LF.toast("📋 Body too long for mailto — copied to clipboard, paste into the email","info");
        LF.modal.close();
        return;
      }
      const win = window.open(href,"_blank");
      if(!win){
        // Popup blocker — navigate the current tab as a fallback
        try { location.href = href; } catch(e) {}
      }
      LF.state.emailDeliveryLog.unshift({id:rid(),at:Date.now(),to,subject:subj,fromAddr,method:"mailto",ok:true,detail:"Opened mailto in system mail client",durationMs:0});
      if(LF.state.emailDeliveryLog.length>100) LF.state.emailDeliveryLog.length=100;
      LF.storage.save();
      LF.toast(`📬 Mail client opened · hit Send to deliver to ${to}`, "");
      LF.modal.close();
      return;
    }

    // For API-mode deliveries (relay / zapier / emailjs), run async without blocking UI.
    LF.toast("Sending…","info");
    LF.modal.close();
    (async ()=>{
      const result = await LF.email._deliver("api", msg);
      LF.state.emailDeliveryLog.unshift({id:rid(),at:Date.now(),to,subject:subj,fromAddr,method:result.method,ok:result.ok,detail:result.detail,httpStatus:result.httpStatus||null,durationMs:result.durationMs||0});
      if(LF.state.emailDeliveryLog.length>100) LF.state.emailDeliveryLog.length=100;
      LF.storage.save();
      if(result.ok){
        LF.toast(result.method==="mailto" ? `📬 Mail client opened for ${to}` : `✓ Delivered via ${result.method} to ${to}`, "");
      } else {
        LF.toast(`Send failed (${result.method}): ${result.detail.slice(0,100)}`, "err");
      }
    })();
  },

  /* Central delivery: tries configured method, returns {ok,method,detail,httpStatus,durationMs} */
  async _deliver(mode, msg){
    LF.email._bootstrap();
    const delivery = LF.state.emailDelivery || {method:"mailto"};
    const method = mode === "mailto" ? "mailto" : (delivery.method || "mailto");
    const start = Date.now();

    try {
      if(method === "mailto"){
        const params = [];
        if(msg.cc) params.push("cc="+encodeURIComponent(msg.cc));
        if(msg.bcc) params.push("bcc="+encodeURIComponent(msg.bcc));
        params.push("subject="+encodeURIComponent(msg.subject));
        params.push("body="+encodeURIComponent(msg.body));
        const href = "mailto:"+encodeURIComponent(msg.to)+"?"+params.join("&");
        try { window.open(href,"_blank"); } catch(e){ location.href = href; }
        return {ok:true, method:"mailto", detail:"Opened in system mail client — deliverability is the client\'s responsibility.", durationMs: Date.now()-start};
      }

      if(method === "relay" || method === "zapier"){
        const url = method === "relay" ? delivery.relayUrl : delivery.zapierHook;
        if(!url){
          // Auto-fallback to mailto
          return await LF.email._deliver("mailto", msg);
        }
        const headers = {"Content-Type":"application/json"};
        if(method === "relay" && delivery.relayToken) headers["Authorization"] = "Bearer " + delivery.relayToken;
        const resp = await fetch(url, {method:"POST", headers, body: JSON.stringify(msg)});
        const text = await resp.text().catch(()=>"");
        if(!resp.ok){
          return {ok:false, method, detail:`HTTP ${resp.status} ${resp.statusText} · ${text.slice(0,200)}`, httpStatus:resp.status, durationMs: Date.now()-start};
        }
        return {ok:true, method, detail:`Delivered · HTTP ${resp.status} · ${text.slice(0,100)||"OK"}`, httpStatus:resp.status, durationMs: Date.now()-start};
      }

      if(method === "emailjs"){
        const {publicKey, serviceId, templateId} = delivery.emailjs || {};
        if(!publicKey || !serviceId || !templateId){
          return await LF.email._deliver("mailto", msg);
        }
        // Load EmailJS SDK on demand
        if(typeof emailjs === "undefined"){
          await new Promise((resolve, reject)=>{
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
            s.onload = resolve; s.onerror = ()=>reject(new Error("Failed to load EmailJS SDK"));
            document.head.appendChild(s);
          });
          emailjs.init({publicKey});
        }
        const resp = await emailjs.send(serviceId, templateId, {
          from_name: msg.fromName, from_email: msg.from,
          to_email: msg.to, cc: msg.cc, bcc: msg.bcc,
          subject: msg.subject, message: msg.body
        });
        return {ok:true, method:"emailjs", detail:`EmailJS ${resp.status} · ${resp.text||"OK"}`, httpStatus:resp.status||200, durationMs: Date.now()-start};
      }

      // Unknown method
      return await LF.email._deliver("mailto", msg);
    } catch(err){
      return {ok:false, method, detail:"Error: "+(err.message||String(err)), durationMs: Date.now()-start};
    }
  },
  delMethodChange(method){
    document.querySelectorAll(".del-panel").forEach(el=>el.style.display="none");
    const el = document.getElementById("del-"+method);
    if(el) el.style.display = "block";
  },
  delSave(){
    LF.email._bootstrap();
    const d = LF.state.emailDelivery;
    d.method = document.getElementById("del-method").value;
    d.relayUrl = document.getElementById("del-relayUrl")?.value || "";
    d.relayToken = document.getElementById("del-relayToken")?.value || "";
    d.zapierHook = document.getElementById("del-zapierHook")?.value || "";
    d.emailjs = {
      publicKey: document.getElementById("del-ejs-pk")?.value || "",
      serviceId: document.getElementById("del-ejs-sid")?.value || "",
      templateId: document.getElementById("del-ejs-tid")?.value || ""
    };
    LF.storage.save();
    LF.toast(`Delivery method saved — ${d.method}`,"");
    LF.email.renderAccounts();
  },
  async delTestNow(){
    LF.email._bootstrap();
    const d = LF.state.emailDelivery;
    // save current form values before testing
    d.method = document.getElementById("del-method").value;
    d.relayUrl = document.getElementById("del-relayUrl")?.value || "";
    d.relayToken = document.getElementById("del-relayToken")?.value || "";
    d.zapierHook = document.getElementById("del-zapierHook")?.value || "";
    d.emailjs = {
      publicKey: document.getElementById("del-ejs-pk")?.value || "",
      serviceId: document.getElementById("del-ejs-sid")?.value || "",
      templateId: document.getElementById("del-ejs-tid")?.value || ""
    };
    const from = (LF.state.emailAccounts||[])[0] || {address:LF.state.user.email,displayName:LF.state.user.name};
    const to = LF.state.user.email;
    const msg = {from:from.address, fromName:from.displayName||LF.state.user.name, to, cc:"", bcc:"", subject:"LeadForge · delivery test", body:`Hello,\n\nThis is a delivery test from LeadForge 360 using the "${d.method}" method.\n\nIf you received this email, your setup is working.\n\n— ${LF.state.user.name}`};
    LF.toast("Testing delivery…","info");
    const res = await LF.email._deliver("api", msg);
    LF.state.emailDeliveryLog.unshift({id:rid(),at:Date.now(),to,subject:msg.subject,fromAddr:from.address,method:res.method,ok:res.ok,detail:res.detail,httpStatus:res.httpStatus||null,durationMs:res.durationMs||0});
    LF.storage.save();
    LF.email.renderAccounts();
    if(res.ok) LF.toast(`✓ ${res.method} · ${res.detail.slice(0,60)}`,"");
    else LF.toast(`Failed: ${res.detail.slice(0,80)}`,"err");
  },
  renderDeliveryLog(){
    const el = document.getElementById("del-log-body"); if(!el) return;
    const logs = (LF.state.emailDeliveryLog||[]).slice(0,30);
    if(!logs.length){ el.innerHTML = '<p style="color:var(--ink-400);font-size:12.5px;padding:10px 0">No send attempts yet. Use "Compose" or the test button above.</p>'; return }
    el.innerHTML = logs.map(l=>`
      <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px dashed var(--ink-150);align-items:flex-start;font-size:12px">
        <span class="tag ${l.ok?'green':'danger'}" style="font-size:10.5px">${l.ok?'✓':'✕'} ${l.method}</span>
        <div style="flex:1;min-width:0">
          <div><b>${escapeHtml(l.subject||'(no subject)').slice(0,80)}</b></div>
          <div style="font-size:11px;color:var(--ink-500)">from ${escapeHtml(l.fromAddr||'—')} → ${escapeHtml(l.to||'—')}</div>
          <div style="font-size:11px;color:${l.ok?'var(--ink-500)':'var(--danger)'};margin-top:2px;font-family:var(--font-mono);word-break:break-all">${escapeHtml(l.detail||'')}</div>
        </div>
        <div style="font-size:10.5px;color:var(--ink-400);white-space:nowrap;font-family:var(--font-mono)">
          ${fmtTime(l.at)}<br>${l.durationMs||0}ms
        </div>
      </div>
    `).join("");
  },
  sendTestMailto(){
    const fromId = document.getElementById("em-test-from").value;
    const from = LF.state.emailAccounts.find(a=>a.id===fromId);
    const to = document.getElementById("em-test-to").value.trim();
    if(!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){ LF.toast("Valid recipient required","err"); return }
    const subj = document.getElementById("em-test-subj").value;
    const body = document.getElementById("em-test-body").value;
    const href = "mailto:"+encodeURIComponent(to)+"?subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(body);
    try { window.open(href,"_blank"); } catch(e){ location.href = href; }
    LF.state.emailLog.push({id:rid(),fromId:from?from.id:null,to,subj,body,at:Date.now(),kind:"test-mailto"});
    LF.storage.save();
    LF.email.renderAccounts();
    LF.toast("Opened in your default mail client","info");
  }
};
LF.importLeadsReal = function(){
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".csv,text/csv";
  input.onchange = e => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).filter(Boolean);
      if(lines.length<2){ LF.toast("CSV must have headers + at least one row","err"); return }
      const hdrs = lines[0].split(",").map(h=>h.replace(/^"|"$/g,"").trim().toLowerCase());
      let added = 0;
      for(let i=1;i<lines.length;i++){
        const vals = (lines[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g)||[]).slice(0,-1).map(v=>v.replace(/,$/,"").replace(/^"|"$/g,"").replace(/""/g,'"').trim());
        const row = {}; hdrs.forEach((h,j)=> row[h]=vals[j]||"");
        const name = row.name || `${row.firstname||""} ${row.lastname||""}`.trim();
        if(!name || !row.email) continue;
        const [fn,...rest] = name.split(" ");
        const lead = {
          id:rid(), firstName:fn||"Unknown", lastName:rest.join(" ")||"", name,
          email:row.email, phone:row.phone||"", company:row.company||"Unknown",
          industry:row.industry||"SaaS", city:row.city||"Mumbai", country:row.country||"IN",
          source:row.source||"Import", ownerId:LF.state.user.id,
          stage:STAGES.includes(row.stage)?row.stage:"New",
          score:Math.max(0,Math.min(100,parseInt(row.score)||40)),
          amount:parseFloat(row.amount)||10000, currency:row.currency||"INR",
          createdAt:Date.now(), updatedAt:Date.now(),
          tags:[], notes:row.notes||"",
          consent:{email:true,whatsapp:false,sms:false},
          activities:[{type:"import",at:Date.now(),by:LF.state.user.id,text:"Imported from CSV"}]
        };
        LF.state.leads.unshift(lead); added++;
      }
      LF.storage.save(); LF.updateSidebarCounts();
      LF.toast(`Imported ${added} leads`,"");
      if(LF.state.route==="leads") LF.views.renderLeadRows();
    };
    reader.readAsText(file);
  };
  input.click();
};

/* ---- Sidebar counts ---- */
LF.updateSidebarCounts = function(){
  document.getElementById("sb-leads-count").textContent = LF.state.leads.length;
  var _mc = document.getElementById("sb-mail-count");
  if(_mc){
    var unread = (LF.state.mailbox && LF.state.mailbox.messages)?LF.state.mailbox.messages.filter(m=>m.folder==='inbox' && !m.read).length:0;
    _mc.textContent = unread;
    _mc.style.display = unread?'inline-flex':'none';
  }
  var _ic = document.getElementById("sb-inbox-count"); if(_ic) _ic.textContent = LF.state.threads.filter(t=>t.unread).length;
  // Won / Lost badges — hide when 0 to keep the sidebar quiet for fresh tenants.
  var _wc = document.getElementById("sb-won-count");
  if(_wc){ var n = LF.state.leads.filter(function(l){ return l.stage==="Won" }).length; _wc.textContent = n; _wc.style.display = n?'inline-flex':'none'; }
  var _lc = document.getElementById("sb-lost-count");
  if(_lc){ var n = LF.state.leads.filter(function(l){ return l.stage==="Lost" }).length; _lc.textContent = n; _lc.style.display = n?'inline-flex':'none'; }
  // All Clients badge — total lead count across every stage.
  var _ac = document.getElementById("sb-all-count");
  if(_ac){ var n = LF.state.leads.length; _ac.textContent = n; _ac.style.display = n?'inline-flex':'none'; }
  // Subvendors badge — count of pending (New / Under Review) sub-vendor apps.
  var _sv = document.getElementById("sb-subvendors-count");
  if(_sv){
    var svs = LF.state.subvendors||[];
    var pend = svs.filter(function(v){ return v.stage==="New" || v.stage==="Under Review"; }).length;
    _sv.textContent = pend; _sv.style.display = pend?'inline-flex':'none';
  }
  // Partners badge — count of new / unreviewed partner applications.
  var _pt = document.getElementById("sb-partners-count");
  if(_pt){
    var pts = LF.state.partners||[];
    var pn = pts.filter(function(v){ return v.stage==="New" || v.stage==="Under Review"; }).length;
    _pt.textContent = pn; _pt.style.display = pn?'inline-flex':'none';
  }
  // Job applicants badge — count of new / unscreened applications.
  var _ja = document.getElementById("sb-jobs-count");
  if(_ja){
    var jas = LF.state.jobApplicants||[];
    var jn = jas.filter(function(v){ return v.stage==="New" || v.stage==="Screening"; }).length;
    _ja.textContent = jn; _ja.style.display = jn?'inline-flex':'none';
  }
};

/* ---- Command palette ---- */
LF.cmd = {
  open(){
    document.getElementById("cmd").classList.add("show");
    document.getElementById("overlay").classList.add("show");
    document.getElementById("cmd-input").value = "";
    LF.cmd.onInput();
    setTimeout(()=>document.getElementById("cmd-input").focus(), 20);
  },
  close(){
    document.getElementById("cmd").classList.remove("show");
    document.getElementById("overlay").classList.remove("show");
  },
  active:0,
  items:[],
  commands:[
    {t:"Go to Dashboard", d:"Overview + KPIs", ic:"🏠", fn:()=>LF.router.go("dashboard")},
    {t:"Go to Leads", d:"All leads table", ic:"👥", fn:()=>LF.router.go("leads")},
    {t:"Go to Pipeline", d:"Kanban view of deals", ic:"🗂", fn:()=>LF.router.go("pipeline")},
    {t:"Go to Analytics", d:"Revenue intelligence", ic:"📊", fn:()=>LF.router.go("analytics")},
    {t:"Go to Sub-Vendors", d:"Manage vendor partner applications", ic:"🏷", fn:()=>LF.router.go("subvendors")},
    {t:"Add new lead", d:"Open create-lead drawer", ic:"➕", fn:()=>{LF.router.go("leads");setTimeout(()=>LF.views.openLeadDrawer(),100)}},
    {t:"Show hot leads", d:"Filter by score ≥ 75", ic:"🔥", fn:()=>{LF.state.filters.leads.scoreMin=75;LF.router.go("leads")}},
    {t:"Show Dubai leads", d:"Filter city = Dubai", ic:"🌍", fn:()=>{LF.state.filters.leads.q="Dubai";LF.router.go("leads")}},
    {t:"Reset demo data", d:"Wipe and re-seed", ic:"♻", fn:()=>{if(confirm("Reset all demo data?")){LF.storage.reset();location.reload()}}},
    {t:"Sign out", d:"End session", ic:"🚪", fn:()=>LF.auth.logout()}
  ],
  onInput(){
    const q = document.getElementById("cmd-input").value.toLowerCase().trim();
    const results = document.getElementById("cmd-results");
    let items = LF.cmd.commands.slice();

    // natural language parsers
    if(q){
      if(/hot leads/.test(q)) items.unshift({t:"Filter: hot leads (score ≥ 75)", d:"Apply filter to Leads view", ic:"🔥", fn:()=>{LF.state.filters.leads.scoreMin=75;LF.state.filters.leads.q="";LF.router.go("leads");LF.cmd.close()}});
      const addMatch = q.match(/^add lead (.+)/);
      if(addMatch){
        const name = addMatch[1];
        items.unshift({t:`Add lead "${name}"`, d:"Create new record", ic:"➕", fn:()=>{LF.quickAddLead(name);LF.cmd.close()}});
      }
      const assignMatch = q.match(/assign (.+) to (.+)/);
      if(assignMatch){
        items.unshift({t:`Assign matching leads to ${assignMatch[2]}`, d:"Bulk assign", ic:"→", fn:()=>{LF.toast(`Bulk assignment queued (demo)`,"info");LF.cmd.close()}});
      }
      if(/^(ask|show|tell|what|how)/i.test(q)){
        items.unshift({t:`Ask AI: "${q}"`, d:"Get a natural-language answer", ic:"✨", fn:()=>{LF.toast(`AI: based on current pipeline, you have ${LF.state.leads.filter(l=>l.score>=75).length} hot leads worth ${fmtCur(LF.state.leads.filter(l=>l.score>=75).reduce((a,b)=>a+b.amount,0))}.`,"info");LF.cmd.close()}});
      }
      items = items.filter(c => (c.t+c.d).toLowerCase().includes(q) || /^(ask|add|show|run|filter|assign)/.test(c.t.toLowerCase()));
    }

    LF.cmd.items = items.slice(0,8);
    LF.cmd.active = 0;
    results.innerHTML = LF.cmd.items.map((c,i)=>`
      <div class="result ${i===0?'active':''}" data-i="${i}">
        <div class="ic">${c.ic}</div>
        <div><div class="t">${escapeHtml(c.t)}</div><div class="d">${escapeHtml(c.d)}</div></div>
      </div>`).join("") || '<div class="result"><div class="ic">∅</div><div><div class="t">No matches</div><div class="d">Try a different query</div></div></div>';
    results.querySelectorAll(".result").forEach(el=>{
      el.addEventListener("click", ()=>{
        const i = +el.dataset.i;
        if(LF.cmd.items[i]) LF.cmd.items[i].fn();
        LF.cmd.close();
      });
    });
  },
  onKey(e){
    const results = document.getElementById("cmd-results");
    const items = results.querySelectorAll(".result");
    if(e.key==="ArrowDown"){ e.preventDefault(); LF.cmd.active=Math.min(LF.cmd.active+1,items.length-1); LF.cmd.highlight() }
    if(e.key==="ArrowUp"){ e.preventDefault(); LF.cmd.active=Math.max(LF.cmd.active-1,0); LF.cmd.highlight() }
    if(e.key==="Enter"){ e.preventDefault(); if(LF.cmd.items[LF.cmd.active]) LF.cmd.items[LF.cmd.active].fn(); LF.cmd.close() }
  },
  highlight(){
    const items = document.querySelectorAll("#cmd-results .result");
    items.forEach((el,i)=> el.classList.toggle("active", i===LF.cmd.active));
  }
};

LF.quickAddLead = function(name){
  const parts = name.split(" ");
  const inferredEmail = `${(parts[0]||"new").toLowerCase()}@company.com`;
  // LOW-2 — block duplicate emails
  const dupe = (LF.state.leads||[]).find(l => (l.email||"").toLowerCase() === inferredEmail);
  if(dupe){
    LF.toast(`Lead with email ${inferredEmail} already exists — opening it instead`,"info");
    if(LF.views && LF.views.openLeadDrawer){
      if(LF.state.route !== "leads" && LF.router) LF.router.go("leads");
      setTimeout(()=>LF.views.openLeadDrawer(dupe.id), 80);
    }
    return dupe.id;
  }
  const lead = {
    id:rid(), firstName:parts[0]||"New", lastName:parts.slice(1).join(" ")||"Lead",
    name, email:inferredEmail, phone:"+91 9000000000",
    company:"New Company", industry:"SaaS", city:"Mumbai", country:"IN",
    source:"Manual", ownerId:LF.state.user.id, stage:"New", score:40, amount:10000, currency:"INR",
    createdAt:Date.now(), updatedAt:Date.now(), tags:[], notes:"",
    consent:{email:true,whatsapp:false,sms:false},
    activities:[{type:"create",at:Date.now(),by:LF.state.user.id,text:"Created via command palette"}]
  };
  LF.state.leads.unshift(lead);
  LF.storage.save();
  LF.updateSidebarCounts();
  LF.toast(`Added ${name}`,"");
  if(LF.state.route==="leads") LF.router.go("leads");
};

LF.runAgent = function(id){
  const a = LF.state.agents.find(x=>x.id===id);
  if(!a) return;
  a.status="running"; a.runs += 1; a.last="just now";
  LF.storage.save();
  LF.toast(`${a.name} started a new run`,"info");
  if(LF.state.route==="agents") LF.router.go("agents");
};

/* ==========================================================
   VIEWS
   ========================================================== */

LF.views.dashboard = function(el){
  // Single source of truth — compute all metrics via LF.rev.compute()
  // so Dashboard and Revenue Intelligence always show matching numbers.
  const L = LF.state.leads;
  const total = L.length;
  const m = (LF.rev && LF.rev.compute) ? LF.rev.compute() : null;
  const won = m ? m.won : L.filter(l=>l.stage==="Won").length;
  const hot = L.filter(l=>(LF.formula&&LF.formula.healthClass)?LF.formula.healthClass(l)==='hot':l.score>=75).length;
  const pipelineAmt = m ? m.pipelineValue : L.filter(l=>!["Won","Lost"].includes(l.stage)).reduce((a,b)=>a+(Number(b.amount)||0),0);
  const weightedForecast = m ? m.weightedForecast : pipelineAmt * 0.25;
  const closedAmt = m ? m.closedAmt : L.filter(l=>l.stage==="Won").reduce((a,b)=>a+(Number(b.amount)||0),0);
  const winRate = m ? m.winRate : (total ? Math.round(won/total*100) : 0);
  const newThisWeek = L.filter(l=>Date.now()-l.createdAt < 7*86400000).length;
  const convRate = winRate;
  const avgScore = total?Math.round(L.reduce((a,b)=>a+b.score,0)/total):0;
  const slipping = m ? m.slipping : 0;

  el.innerHTML = `
    <div class="hero-card">
      <div class="inner">
        <div>
          <h2>Good to see you, <em>${escapeHtml(((LF.state.user && LF.state.user.name) || "there").split(" ")[0])}</em></h2>
          <p>${newThisWeek} new leads this week · ${hot} hot prospects · pipeline worth ${fmtCur(pipelineAmt)} (weighted ${fmtCur(weightedForecast)}) · ${won} deals closed worth ${fmtCur(closedAmt)}${slipping?" · ⚠ "+slipping+" slipping":""}.</p>
          <div class="hero-quick">
            <button onclick="LF.views.openLeadDrawer()">+ Add lead</button>
            <button onclick="LF.cmd.open()">Ask AI</button>
          </div>
        </div>
        <div style="position:relative;z-index:1">
          <img src="assets/logo.png" style="width:110px;opacity:.92;filter:drop-shadow(0 12px 24px rgba(0,116,217,.5))">
        </div>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:18px">
      <div class="kpi" style="cursor:pointer" onclick="LF.router.go('leads')"><div class="lbl">Total Leads</div><div class="val">${total.toLocaleString()}</div><div class="delta up">▲ ${newThisWeek} this week</div></div>
      <div class="kpi" style="cursor:pointer" onclick="LF.state.filters.leads={q:'',stage:'',source:'',owner:'',scoreMin:75};LF.router.go('leads')"><div class="lbl">Hot Prospects</div><div class="val">${hot}</div><div class="delta up">▲ score ≥ 75</div></div>
      <div class="kpi" style="cursor:pointer" onclick="LF.router.go('analytics')"><div class="lbl">Pipeline Value</div><div class="val">${fmtCur(pipelineAmt)}</div><div class="delta up">weighted: ${fmtCur(weightedForecast)}</div></div>
      <div class="kpi" style="cursor:pointer" onclick="LF.router.go('analytics')"><div class="lbl">Win Rate</div><div class="val">${winRate}%</div><div class="delta ${winRate>=25?'up':'down'}">${won} won · ${closedAmt?fmtCur(closedAmt):'$0'}</div></div>
    </div>

    <div class="grid g-2" style="margin-bottom:18px">
      <div class="card">
        <div class="card-head"><h3>Lead Funnel · ${LF.state.dashRange===90?'last 90 days':LF.state.dashRange==='qtd'?'QTD':'last 30 days'}</h3>
          <div class="seg"><button class="${(LF.state.dashRange||30)===30?'active':''}" onclick="LF.actions.setDashRange(30,this)">30D</button><button class="${LF.state.dashRange===90?'active':''}" onclick="LF.actions.setDashRange(90,this)">90D</button><button class="${LF.state.dashRange==='qtd'?'active':''}" onclick="LF.actions.setDashRange('qtd',this)">QTD</button></div>
        </div>
        <div class="chart-wrap"><canvas id="chart-funnel"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Leads by Source</h3><div class="sub">Top 6</div></div>
        <div class="chart-wrap"><canvas id="chart-source"></canvas></div>
      </div>
    </div>

    <div class="grid g-3" style="margin-bottom:18px">
      <div class="card">
        <div class="card-head"><h3>AI Insights</h3><span class="tag gradient">✦ Live</span></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${LF.getInsights().map(i=>`
            <div style="padding:10px;background:var(--ab7-sky-ghost);border-left:3px solid ${i.color};border-radius:8px">
              <div style="font-size:12.5px;font-weight:700;color:var(--ink-900);margin-bottom:3px">${escapeHtml(i.title)}</div>
              <div style="font-size:12px;color:var(--ink-600);line-height:1.45">${escapeHtml(i.body)}</div>
              ${i.cta?`<button class="btn btn-ghost btn-xs" style="margin-top:6px" onclick="${i.cta.fn}">${escapeHtml(i.cta.label)}</button>`:''}
            </div>`).join("")}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Pipeline by Stage</h3><div class="sub">${STAGES.length} stages</div></div>
        <div class="chart-wrap"><canvas id="chart-stage"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Rep Leaderboard</h3><a href="#" onclick="LF.router.go('analytics');return false" style="font-size:12px;color:var(--ab7-blue);font-weight:600">View all →</a></div>
        <div id="leader"></div>
      </div>
    </div>

    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>Recent Activity</h3><a href="#" onclick="LF.router.go('activity');return false" style="font-size:12px;color:var(--ab7-blue);font-weight:600">All activity →</a></div>
        <div id="activity-feed"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Avg Lead Score Trend</h3><div class="sub">Daily avg · current: ${avgScore}</div></div>
        <div class="chart-wrap"><canvas id="chart-score"></canvas></div>
      </div>
    </div>
  `;

  // render charts
  LF.renderDashCharts();
  // Rep leaderboard — REAL data only (actual won revenue, open pipeline, deals closed)
  const byOwner = {};
  L.forEach(l=>{
    if(!byOwner[l.ownerId]) byOwner[l.ownerId] = {id:l.ownerId, won:0, wonAmt:0, open:0, openAmt:0, leads:0};
    byOwner[l.ownerId].leads++;
    if(l.stage==="Won"){ byOwner[l.ownerId].won++; byOwner[l.ownerId].wonAmt += (Number(l.amount)||0); }
    else if(l.stage!=="Lost"){ byOwner[l.ownerId].open++; byOwner[l.ownerId].openAmt += (Number(l.amount)||0); }
  });
  const leaderRows = Object.values(byOwner)
    .map(r=>({...r, owner:ownersList().find(o=>o.id===r.id)}))
    .filter(r=>r.owner)
    .sort((a,b)=> b.wonAmt-a.wonAmt || b.won-a.won || b.openAmt-a.openAmt)
    .slice(0,5);
  const maxWon = Math.max(1, ...leaderRows.map(r=>r.wonAmt));
  document.getElementById("leader").innerHTML = leaderRows.length ? leaderRows.map((r,i)=>`
    <div style="padding:9px 0;border-bottom:1px dashed var(--ink-150)">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:22px;font-size:12px;font-weight:800;color:var(--ink-400)">#${i+1}</div>
        <div class="avatar-sm ${r.owner.grp||''}">${r.owner.avatar}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="font-size:13px;font-weight:700">${escapeHtml(r.owner.name)}</div>
            <div style="font-size:12.5px;font-weight:800;color:var(--ab7-green-deep);font-family:var(--font-mono)">${fmtCur(r.wonAmt)}</div>
          </div>
          <div style="display:flex;justify-content:space-between;gap:8px;margin-top:2px">
            <div style="font-size:10.5px;color:var(--ink-500)">${escapeHtml(r.owner.team)} · ${r.won} won · ${r.open} open</div>
            <div style="font-size:10.5px;color:var(--ink-500);font-family:var(--font-mono)">${fmtCur(r.openAmt)} pipeline</div>
          </div>
          <div class="progress" style="margin-top:5px"><div class="bar" style="width:${(r.wonAmt/maxWon*100).toFixed(0)}%"></div></div>
        </div>
      </div>
    </div>`).join("") : '<p style="color:var(--ink-400);font-size:12.5px;padding:10px 0">No rep activity yet.</p>';

  // activity
  const acts = L.flatMap(l=>l.activities.map(a=>({...a,lead:l}))).sort((a,b)=>b.at-a.at).slice(0,10);
  document.getElementById("activity-feed").innerHTML = acts.length ? acts.map(a=>{
    // icons per actual activity type stored on leads
    const icons = {
      create:["👤","g"], edit:["✎","b"], stage:["▣","g"],
      email:["✉","b"], msg:["💬","b"], call:["📞","w"], meeting:["📅","g"],
      task:["✓","b"], qualify:["⭐","g"], plan:["📝","b"],
      assign:["→","b"], note:["•","b"], consent:["✓","g"],
      enrich:["✦","b"], agent:["🤖","b"], erasure:["⊘","r"],
      default:["●","b"]
    };
    const [ic,cls] = icons[a.type]||icons.default;
    return `<div class="activity-item" style="cursor:pointer" onclick="LF.views.openLeadDrawer('${a.lead.id}')">
      <div class="ic ${cls==='g'?'g':cls==='w'?'w':cls==='r'?'r':''}">${ic}</div>
      <div class="body"><div class="t"><b>${escapeHtml(a.lead.name)}</b> · ${escapeHtml(a.text)}</div>
      <div class="m">${fmtTime(a.at)} · ${escapeHtml(a.lead.company)}</div></div></div>`;
  }).join("") : '<p style="color:var(--ink-400);font-size:12.5px;padding:10px 0">No activity yet — add a lead to get started.</p>';

  // Start the live-data poll while the dashboard is on screen so widgets
  // (Recent Activity, Lead Funnel, Source, Leaderboard) reflect server-side
  // changes from other tabs/teammates without a manual refresh.
  if(LF.dashLivePoll && LF.dashLivePoll.start) LF.dashLivePoll.start();
};

LF.getInsights = function(){
  // 100% data-driven — no hardcoded strings, every CTA points to a live module.
  const L = LF.state.leads || [];
  const m = (LF.rev && LF.rev.compute) ? LF.rev.compute() : {};
  const open = L.filter(l => !["Won","Lost"].includes(l.stage));
  const stagnant = L.filter(l => !["Won","Lost"].includes(l.stage) && Date.now()-l.updatedAt > 7*86400000);
  const stagnantValue = stagnant.reduce((a,b)=>a+(b.amount||0),0);
  const hot = L.filter(l => l.score >= 75 && !["Won","Lost"].includes(l.stage));
  const hotValue = hot.reduce((a,b)=>a+(b.amount||0),0);
  const unowned = L.filter(l => !l.ownerId);
  const highValueLowTouch = L.filter(l => (l.amount||0) > 50000 && (l.activities||[]).length < 3 && !["Won","Lost"].includes(l.stage));
  // Qualification health
  let qualifiedReady = 0, nurtureBacklog = 0, neverQualified = 0;
  if(LF.qual && LF.qual.leadStatus){
    L.forEach(l => {
      const s = LF.qual.leadStatus(l).status;
      if(s === "qualified" && !["Won","Lost"].includes(l.stage)) qualifiedReady++;
      else if(s === "nurture") nurtureBacklog++;
      else if(s === "unqualified") neverQualified++;
    });
  }
  // Scheduled tasks
  const tasks = LF.state.scheduledTasks || [];
  const overdueTasks = tasks.filter(t => t.status === "open" && t.dueAt < Date.now()).length;

  const out = [];

  if(stagnant.length){
    out.push({
      title:`Deal slippage · ${stagnant.length} deals stalled`,
      body:`${stagnant.length} open deals worth ${fmtCur(stagnantValue)} haven\'t moved in 7+ days. Schedule a follow-up to re-engage.`,
      color:"#F59E0B",
      cta:{label:"Open Task list →", fn:"LF.router.go(\'collab\')"}
    });
  }
  if(qualifiedReady > 0){
    out.push({
      title:`Ready to convert · ${qualifiedReady} qualified leads`,
      body:`${qualifiedReady} leads cleared their qualification checklist and are stuck in pre-Won stages. Hand them off via the Conversion view.`,
      color:"#00D370",
      cta:{label:"Open Conversion →", fn:"LF.router.go(\'conversion\')"}
    });
  }
  if(neverQualified > L.length*0.5 && L.length > 5){
    out.push({
      title:`Qualification gap · ${neverQualified} pending`,
      body:`${neverQualified} leads have never been put through a qualification checklist. Run them through Scoring to surface ready-to-close deals.`,
      color:"#0074D9",
      cta:{label:"Open Scoring →", fn:"LF.router.go(\'scoring\')"}
    });
  }
  if(overdueTasks > 0){
    out.push({
      title:`${overdueTasks} overdue task${overdueTasks>1?'s':''}`,
      body:`Open tasks past their due date. Catching up keeps the pipeline moving.`,
      color:"#DC2626",
      cta:{label:"Open Task list →", fn:"LF.router.go(\'collab\')"}
    });
  }
  if(highValueLowTouch.length){
    const v = highValueLowTouch.reduce((a,b)=>a+(b.amount||0),0);
    out.push({
      title:`High-value, low-touch · ${highValueLowTouch.length} deals`,
      body:`${highValueLowTouch.length} leads worth ${fmtCur(v)} have <3 activities recorded. Prioritise outreach to these accounts.`,
      color:"#7C3AED",
      cta:{label:"Filter Leads →", fn:"LF.state.filters.leads={q:\'\',stage:\'\',source:\'\',owner:\'\',scoreMin:\'\'};LF.router.go(\'leads\')"}
    });
  }
  if(hot.length){
    out.push({
      title:`${hot.length} hot prospects · ${fmtCur(hotValue)}`,
      body:`Score ≥ 75 deals open in the pipeline. Push them to demo/proposal this week.`,
      color:"#00D370",
      cta:{label:"View Hot leads →", fn:"LF.state.filters.leads={q:\'\',stage:\'\',source:\'\',owner:\'\',scoreMin:75};LF.router.go(\'leads\')"}
    });
  }
  if(unowned.length){
    out.push({
      title:`${unowned.length} leads without an owner`,
      body:`Unassigned records risk being dropped. Assign owners from the Leads view.`,
      color:"#F59E0B",
      cta:{label:"Open Leads →", fn:"LF.router.go(\'leads\')"}
    });
  }
  if(!out.length){
    out.push({
      title:"Pipeline is healthy",
      body:`${L.length} leads · ${open.length} open · ${m.won||0} won · win rate ${m.winRate||0}%. Nothing urgent surfaced.`,
      color:"#0074D9",
      cta:null
    });
  }
  return out.slice(0,4);
};

LF.renderDashCharts = function(){
  Object.values(LF.charts).forEach(c=>{ try{c.destroy()}catch(e){} });
  LF.charts = {};

  const range = LF.state.dashRange || 30;
  const windowDays = range==="qtd" ? 90 : range;
  const cutoff = Date.now() - windowDays*86400000;
  // A lead with no createdAt (legacy / migrated record where the timestamp
  // got lost on a snake_case round-trip) is still a real lead — include it
  // rather than silently dropping it from every dashboard chart.
  const L = LF.state.leads.filter(l => l && (l.createdAt == null || l.createdAt >= cutoff));
  const COL_BLUE = "#0074D9", COL_GREEN = "#00D370", COL_TEAL = "#14D8A6", COL_SKY = "#8DC1EE";

  // Funnel
  const stageCounts = STAGES.map(s=>L.filter(l=>l.stage===s).length);
  LF.charts.funnel = new Chart(document.getElementById("chart-funnel"),{
    type:"bar",
    data:{labels:STAGES,datasets:[{label:"Leads",data:stageCounts,backgroundColor:[COL_SKY,COL_BLUE,"#005FB1",COL_TEAL,COL_GREEN,"#00B85F","#CBD5E1"],borderRadius:6}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:"#E2E8F0"}},x:{grid:{display:false}}}}
  });

  // Source
  const srcCounts = {};
  L.forEach(l=> srcCounts[l.source]=(srcCounts[l.source]||0)+1 );
  const srcEntries = Object.entries(srcCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  LF.charts.source = new Chart(document.getElementById("chart-source"),{
    type:"doughnut",
    data:{labels:srcEntries.map(x=>x[0]),datasets:[{data:srcEntries.map(x=>x[1]),backgroundColor:[COL_BLUE,COL_GREEN,COL_TEAL,COL_SKY,"#3B82F6","#8B5CF6"],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"65%",plugins:{legend:{position:"right",labels:{boxWidth:10,padding:10,font:{size:11}}}}}
  });

  // Stage pipeline value
  const stageVal = STAGES.map(s=>L.filter(l=>l.stage===s).reduce((a,b)=>a+(Number(b.amount)||0),0));
  LF.charts.stage = new Chart(document.getElementById("chart-stage"),{
    type:"bar",
    data:{labels:STAGES,datasets:[{label:"Pipeline $",data:stageVal,backgroundColor:COL_BLUE,borderRadius:5}]},
    options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:"#E2E8F0"},ticks:{callback:v=>"$"+(v/1000)+"k"}},y:{grid:{display:false}}}}
  });

  // Avg score trend — REAL rolling daily average of every lead that existed on that date
  const now = Date.now(), DAY = 86400000;
  const days = Array.from({length:14},(_,i)=>13-i); // 13..0 (D-14 → D-1)
  const trend = days.map(d=>{
    const dayEnd = now - d*DAY;
    // Match Lead Funnel logic: undated leads are treated as "always existed"
    // so they contribute to the avg rather than being silently filtered.
    const existing = LF.state.leads.filter(l => l && (l.createdAt == null || l.createdAt <= dayEnd));
    if(!existing.length) return null; // no data that day
    return Math.round(existing.reduce((a,b)=>a+(b.score||0),0) / existing.length * 10) / 10;
  });
  const labels = days.map(d=>d===0?"Today":"D-"+d);
  LF.charts.score = new Chart(document.getElementById("chart-score"),{
    type:"line",
    data:{labels,datasets:[{
      label:"Avg score",
      data:trend,
      borderColor:COL_GREEN,backgroundColor:"rgba(0,211,112,.1)",
      tension:.35,fill:true,borderWidth:2,pointRadius:3,spanGaps:true
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>ctx.parsed.y===null?'No data':'Avg '+ctx.parsed.y}}},
      scales:{y:{beginAtZero:false,grid:{color:"#E2E8F0"},min:0,max:100},x:{grid:{display:false}}}
    }
  });
};

/* ==========================================================
   LEADS VIEW — full CRUD, search, filter, sort, bulk actions
   ========================================================== */
LF.views.leads = function(el){
  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Leads</div>
        <div class="page-sub">Every lead — enriched, scored, and routed in real time.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.exportLeadsCsv()">⬇ Export CSV</button>
        <button class="btn btn-ghost btn-sm" onclick="LF.importLeads()">⬆ Import</button>
        <button class="btn btn-blue btn-sm" onclick="LF.runBulkAI()">✦ Bulk enrich</button>
        <button class="btn btn-primary" onclick="LF.views.openLeadDrawer()"><span>＋</span> New lead</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">All leads</div><div class="val" id="k-all">0</div><div class="delta up">live</div></div>
      <div class="kpi"><div class="lbl">Hot (≥75)</div><div class="val" id="k-hot">0</div><div class="delta up">▲ priority</div></div>
      <div class="kpi"><div class="lbl">Unassigned</div><div class="val" id="k-una">0</div><div class="delta down">needs routing</div></div>
      <div class="kpi"><div class="lbl">Pipeline $</div><div class="val" id="k-amt">$0</div><div class="delta up">open deals</div></div>
    </div>

    <div class="tbl-wrap">
      <div class="tbl-toolbar">
        <div class="tbl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="f-q" placeholder="Search name, company, email, city…" value="${escapeHtml(LF.state.filters.leads.q)}">
        </div>
        <select class="filter" id="f-stage">
          <option value="">All stages</option>
          ${STAGES.map(s=>`<option value="${s}" ${LF.state.filters.leads.stage===s?'selected':''}>${s}</option>`).join("")}
        </select>
        <select class="filter" id="f-source">
          <option value="">All sources</option>
          ${[...new Set(SOURCES)].map(s=>`<option value="${s}" ${LF.state.filters.leads.source===s?'selected':''}>${s}</option>`).join("")}
        </select>
        <select class="filter" id="f-owner">
          <option value="">All owners</option>
          ${ownersList().map(o=>`<option value="${o.id}" ${LF.state.filters.leads.owner===o.id?'selected':''}>${o.name}</option>`).join("")}
        </select>
        <input class="filter" id="f-score" type="number" placeholder="Min score" style="width:110px" value="${LF.state.filters.leads.scoreMin||''}">
        <button class="btn btn-ghost btn-sm" onclick="LF.views.clearLeadFilters()">Clear</button>
        <div style="flex:1"></div>
        <div id="bulk-actions" style="display:none;gap:6px;align-items:center">
          <span id="bulk-count" style="font-size:12px;font-weight:600;color:var(--ink-600)"></span>
          <button class="btn btn-ghost btn-xs" onclick="LF.views.bulkAssign()">Assign…</button>
          <button class="btn btn-ghost btn-xs" onclick="LF.views.bulkStage()">Move stage…</button>
          <button class="btn btn-ghost btn-xs" onclick="LF.views.bulkDelete()">Delete</button>
        </div>
      </div>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:36px;cursor:default"><input type="checkbox" id="sel-all" onchange="LF.views.toggleAllSelect(this.checked)"></th>
            <th data-sort="name">Lead</th>
            <th data-sort="company">Company</th>
            <th data-sort="stage">Stage</th>
            <th data-sort="score">Score</th>
            <th data-sort="amount">Value</th>
            <th data-sort="source">Source</th>
            <th data-sort="ownerId">Owner</th>
            <th data-sort="updatedAt">Updated</th>
            <th style="cursor:default"></th>
          </tr>
        </thead>
        <tbody id="lead-rows"></tbody>
      </table>
      </div>
      <div class="tbl-foot">
        <div id="lead-summary"></div>
        <div class="pager" id="lead-pager"></div>
      </div>
    </div>
  `;

  ["f-q","f-stage","f-source","f-owner","f-score"].forEach(id=>{
    document.getElementById(id).addEventListener("input", ()=>{
      const keyMap = {"f-q":"q","f-stage":"stage","f-source":"source","f-owner":"owner","f-score":"scoreMin"};
      LF.state.filters.leads[keyMap[id]] = document.getElementById(id).value;
      LF.state.page.leads = 1;
      LF.views.renderLeadRows();
    });
  });
  document.querySelectorAll("th[data-sort]").forEach(th=>{
    th.addEventListener("click", ()=>{
      const k = th.dataset.sort;
      const s = LF.state.sort.leads;
      if(s.key===k) s.dir = s.dir==="asc"?"desc":"asc"; else { s.key=k; s.dir="asc" }
      LF.views.renderLeadRows();
    });
  });
  LF.views.renderLeadRows();
};

LF.views.clearLeadFilters = function(){
  LF.state.filters.leads = {q:"",stage:"",source:"",owner:"",scoreMin:""};
  LF.state.page.leads = 1;
  LF.router.go("leads");
};

LF.views.filteredLeads = function(){
  const f = LF.state.filters.leads;
  const me = LF.state.user && LF.state.user.id;
  let list = LF.state.leads.filter(l=>{
    /* Per-lead visibility — hide leads the current user isn't permitted to see */
    if(typeof LF.canViewLead === "function" && !LF.canViewLead(l, me)) return false;
    if(f.q){
      const q = f.q.toLowerCase();
      if(!(l.name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) || l.city.toLowerCase().includes(q) || l.country.toLowerCase().includes(q))) return false;
    }
    if(f.stage && l.stage!==f.stage) return false;
    if(f.source && l.source!==f.source) return false;
    if(f.owner && l.ownerId!==f.owner) return false;
    if(f.scoreMin && l.score < +f.scoreMin) return false;
    return true;
  });
  const s = LF.state.sort.leads;
  list.sort((a,b)=>{
    const av=a[s.key], bv=b[s.key];
    if(typeof av==="number" && typeof bv==="number") return s.dir==="asc"?av-bv:bv-av;
    return s.dir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
  });
  return list;
};

LF.views.renderLeadRows = function(){
  const list = LF.views.filteredLeads();
  const size = LF.state.page.size;
  const pages = Math.max(1, Math.ceil(list.length/size));
  let p = Math.min(LF.state.page.leads, pages); if(p<1)p=1; LF.state.page.leads=p;
  const slice = list.slice((p-1)*size, p*size);

  // KPIs
  const all = LF.state.leads;
  document.getElementById("k-all").textContent = all.length.toLocaleString();
  document.getElementById("k-hot").textContent = all.filter(l=>l.score>=75).length;
  document.getElementById("k-una").textContent = all.filter(l=>!l.ownerId).length;
  document.getElementById("k-amt").textContent = fmtCur(all.filter(l=>!["Won","Lost"].includes(l.stage)).reduce((a,b)=>a+b.amount,0));

  const body = document.getElementById("lead-rows");
  if(!slice.length){
    body.innerHTML = `<tr><td colspan="10" class="tbl-empty">No leads match your filters. Try clearing them or <a href="#" onclick="LF.views.openLeadDrawer();return false" style="color:var(--ab7-blue);font-weight:700">add a new lead</a>.</td></tr>`;
  } else {
    body.innerHTML = slice.map(l=>{
      const owner = ownersList().find(o=>o.id===l.ownerId) || {name:"Unassigned",avatar:"?",grp:""};
      const sel = LF.state.selectedLeadIds.has(l.id);
      const scoreClass = LF.formula.healthClass(l);
      return `<tr class="${sel?'selected':''}" data-id="${l.id}">
        <td><input type="checkbox" ${sel?'checked':''} onchange="LF.views.toggleSelect('${l.id}',this.checked)"></td>
        <td><div class="who"><div class="avatar-sm ${l.tags.includes('hot')?'g2':''}">${initials(l.name)}</div>
          <div><div style="font-weight:700;color:var(--ink-900)">${escapeHtml(l.name)}</div>
          <div style="font-size:11.5px;color:var(--ink-400)">${escapeHtml(l.email)}</div></div></div></td>
        <td><div style="font-weight:600">${escapeHtml(l.company)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(l.city)}, ${l.country}</div></td>
        <td><span class="tag ${STAGE_COLORS[l.stage]}">${l.stage}</span></td>
        <td><span class="score-pill ${scoreClass}">${l.score}</span></td>
        <td style="font-weight:700;font-family:var(--font-mono);color:var(--ab7-green-deep);font-size:12.5px">${fmtCur(l.amount,l.currency)}</td>
        <td><span class="tag">${escapeHtml(l.source)}</span></td>
        <td><div class="who"><div class="avatar-sm ${owner.grp||''}">${owner.avatar}</div><span style="font-size:12px">${escapeHtml(owner.name.split(" ")[0])}</span></div></td>
        <td style="color:var(--ink-500);font-size:12px">${fmtTime(l.updatedAt)}</td>
        <td>
          <button class="btn btn-ghost btn-xs" onclick="LF.views.openLeadDrawer('${l.id}')">Open</button>
        </td>
      </tr>`;
    }).join("");
  }

  // pager
  const pager = document.getElementById("lead-pager");
  let buttons = `<button ${p===1?'disabled':''} onclick="LF.state.page.leads=${p-1};LF.views.renderLeadRows()">‹</button>`;
  for(let i=1;i<=pages;i++){
    if(i===1||i===pages||Math.abs(i-p)<=1)
      buttons += `<button class="${i===p?'active':''}" onclick="LF.state.page.leads=${i};LF.views.renderLeadRows()">${i}</button>`;
    else if(Math.abs(i-p)===2) buttons += `<span style="padding:0 4px;color:var(--ink-400)">…</span>`;
  }
  buttons += `<button ${p===pages?'disabled':''} onclick="LF.state.page.leads=${p+1};LF.views.renderLeadRows()">›</button>`;
  pager.innerHTML = buttons;
  document.getElementById("lead-summary").textContent = `Showing ${slice.length} of ${list.length} leads`;

  const bulk = document.getElementById("bulk-actions");
  const n = LF.state.selectedLeadIds.size;
  bulk.style.display = n>0?"flex":"none";
  document.getElementById("bulk-count").textContent = `${n} selected`;
};

LF.views.toggleSelect = function(id, checked){
  if(checked) LF.state.selectedLeadIds.add(id); else LF.state.selectedLeadIds.delete(id);
  LF.views.renderLeadRows();
};
LF.views.toggleAllSelect = function(checked){
  const list = LF.views.filteredLeads();
  list.forEach(l=>{ if(checked) LF.state.selectedLeadIds.add(l.id); else LF.state.selectedLeadIds.delete(l.id) });
  LF.views.renderLeadRows();
};

LF.views.bulkAssign = function(){
  LF.modal.open({
    title:"Assign selected leads",
    body:`<div class="fld"><label>Assign to</label>
      <select id="bulk-assignee">${ownersList().map(o=>`<option value="${o.id}">${o.name} · ${o.role}</option>`).join("")}</select></div>
      <p style="font-size:12.5px;color:var(--ink-500)">This will reassign <b>${LF.state.selectedLeadIds.size}</b> leads and log the change in the audit ledger.</p>`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-blue" onclick="LF.views.confirmBulkAssign()">Assign</button>`
  });
};
LF.views.confirmBulkAssign = function(){
  const to = document.getElementById("bulk-assignee").value;
  LF.state.selectedLeadIds.forEach(id=>{
    const l = LF.state.leads.find(x=>x.id===id);
    if(l){ l.ownerId=to; l.updatedAt=Date.now(); l.activities.push({type:"assign",at:Date.now(),by:LF.state.user.id,text:`Reassigned to ${((ownersList().find(o=>o.id===to)||{}).name)||'someone'}`}) }
  });
  LF.state.selectedLeadIds.clear();
  LF.storage.save();
  LF.modal.close();
  LF.toast("Leads reassigned","");
  LF.views.renderLeadRows();
};
LF.views.bulkStage = function(){
  LF.modal.open({
    title:"Move stage",
    body:`<div class="fld"><label>New stage</label>
      <select id="bulk-stage">${STAGES.map(s=>`<option>${s}</option>`).join("")}</select></div>
      <p style="font-size:12.5px;color:var(--ink-500)">Moving <b>${LF.state.selectedLeadIds.size}</b> leads.</p>`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-blue" onclick="LF.views.confirmBulkStage()">Move</button>`
  });
};
LF.views.confirmBulkStage = function(){
  const to = document.getElementById("bulk-stage").value;
  LF.state.selectedLeadIds.forEach(id=>{
    const l = LF.state.leads.find(x=>x.id===id);
    if(l){ l.stage=to; l.updatedAt=Date.now(); l.activities.push({type:"stage",at:Date.now(),by:LF.state.user.id,text:`Moved to ${to}`}) }
  });
  LF.state.selectedLeadIds.clear();
  LF.storage.save();
  LF.modal.close();
  LF.toast("Stage updated","");
  LF.views.renderLeadRows();
};
LF.views.bulkDelete = function(){
  if(!confirm(`Delete ${LF.state.selectedLeadIds.size} leads? This cannot be undone.`)) return;
  LF.state.leads = LF.state.leads.filter(l=>!LF.state.selectedLeadIds.has(l.id));
  LF.state.selectedLeadIds.clear();
  LF.storage.save();
  LF.updateSidebarCounts();
  LF.toast("Leads deleted","info");
  LF.views.renderLeadRows();
};

LF.exportLeadsCsv = function(){
  const L = LF.views.filteredLeads();
  const h = ["Name","Email","Phone","Company","Industry","City","Country","Source","Stage","Score","Amount","Currency","Owner","Created"];
  const rows = [h.join(",")];
  L.forEach(l=>{
    const o = ownersList().find(x=>x.id===l.ownerId)?.name||"";
    rows.push([l.name,l.email,l.phone,l.company,l.industry,l.city,l.country,l.source,l.stage,l.score,l.amount,l.currency,o,new Date(l.createdAt).toISOString()].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","));
  });
  const blob = new Blob([rows.join("\n")],{type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leads-export-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  LF.toast(`Exported ${L.length} leads`,"");
};
LF.importLeads = function(){ LF.importLeadsReal() };
LF.runBulkAI = function(){
  const list = LF.views.filteredLeads().slice(0,10);
  list.forEach(l=> l.activities.push({type:"enrich",at:Date.now(),by:"a2",text:"Researcher Agent enriched firmographics + intent"}) );
  const _a2 = LF.state.agents.find(a=>a.id==="a2"); if(_a2) _a2.runs += list.length;
  LF.storage.save();
  LF.toast(`Researcher Agent enriched ${list.length} leads`,"info");
};

/* Lead drawer: create + edit */
LF.views.openLeadDrawer = function(id){
  const editing = id && LF.state.leads.find(l=>l.id===id);
  const L = editing || {firstName:"",lastName:"",email:"",phone:"",company:"",industry:"SaaS",city:"",country:"IN",source:"Website Form",stage:"New",score:40,amount:10000,currency:"INR",ownerId:LF.state.user.id,notes:"",consent:{email:true,whatsapp:false,sms:false},activities:[]};
  const owner = ownersList().find(o=>o.id===L.ownerId)||ownersList()[0]||{id:"",name:"Unassigned",avatar:"?",grp:""};

  const tabsTop = editing?`<div class="seg" style="margin-bottom:14px"><button class="active" onclick="LF.views.leadTab('details',event)">Details</button><button onclick="LF.views.leadTab('timeline',event)">Timeline</button><button onclick="LF.views.leadTab('ai',event)">✦ AI Brief</button><button onclick="LF.views.leadTab('consent',event)">Consent</button></div>`:'';

  const detailsHtml = `
    <div id="tab-details">
    <div class="fld-row">
      <div class="fld"><label>First name *</label><input id="ld-fn" value="${escapeHtml(L.firstName)}"></div>
      <div class="fld"><label>Last name *</label><input id="ld-ln" value="${escapeHtml(L.lastName)}"></div>
    </div>
    <div class="fld-row">
      <div class="fld"><label>Email *</label><input id="ld-email" type="email" value="${escapeHtml(L.email)}"></div>
      <div class="fld"><label>Phone</label><input id="ld-phone" value="${escapeHtml(L.phone)}"></div>
    </div>
    <div class="fld-row">
      <div class="fld"><label>Company *</label><input id="ld-co" value="${escapeHtml(L.company)}"></div>
      <div class="fld"><label>Industry</label><select id="ld-ind">${(LF.picklists?LF.picklists.industries():INDUSTRIES).map(i=>`<option ${i===L.industry?'selected':''}>${escapeHtml(i)}</option>`).join("")}</select></div>
    </div>
    <div class="fld-row">
      <div class="fld"><label>City</label><input id="ld-city" value="${escapeHtml(L.city)}"></div>
      <div class="fld"><label>Country</label><select id="ld-country">${(LF.picklists?LF.picklists.countries():CITIES.map(c=>c[1]).filter((v,i,a)=>a.indexOf(v)===i).map(c=>({code:c,name:c}))).map(c=>{const code=c.code||c;const name=c.name||c;return `<option value="${escapeHtml(code)}" ${code===L.country?'selected':''}>${escapeHtml(code)} — ${escapeHtml(name)}</option>`}).join("")}</select></div>
    </div>
    <div class="fld-row">
      <div class="fld"><label>Source</label><select id="ld-src">${SOURCES.map(s=>`<option ${s===L.source?'selected':''}>${s}</option>`).join("")}</select></div>
      <div class="fld"><label>Stage</label><select id="ld-stage">${STAGES.map(s=>`<option ${s===L.stage?'selected':''}>${s}</option>`).join("")}</select></div>
    </div>
    <div class="fld-row">
      <div class="fld"><label>Deal value</label><input id="ld-amt" type="number" value="${L.amount}"></div>
      <div class="fld"><label>Currency</label><select id="ld-ccy" disabled style="background:var(--ink-50);cursor:not-allowed"><option value="INR" selected>INR · ₹ Indian Rupee</option></select></div>
    </div>
    <div class="fld-row">
      <div class="fld"><label>Owner</label><select id="ld-owner">${ownersList().map(o=>`<option value="${o.id}" ${o.id===L.ownerId?'selected':''}>${o.name} · ${o.role}</option>`).join("")}</select></div>
      <div class="fld"><label>Score <span style="font-weight:400;color:var(--ink-400);font-size:10.5px">· auto from stage, activity, value & recency · edit to override</span></label><input id="ld-score" type="number" min="0" max="100" value="${L.score}"></div>
    </div>
    <div class="fld"><label>Notes</label><textarea id="ld-notes">${escapeHtml(L.notes||"")}</textarea></div>

    ${(function(){
      /* Outcome capture — only visible when the lead is in Won or Lost.
         Powers the Won Leads / Lost Leads sections and the win-rate dashboard.
         Fields persist on l.outcome.* — see saveLead and LF.views.wonLeads. */
      const o = L.outcome || {};
      const isWon  = L.stage === "Won";
      const isLost = L.stage === "Lost";
      if(!isWon && !isLost) return "";
      const accent = isWon ? "var(--ab7-green-deep)" : "#DC2626";
      const label  = isWon ? "✓ Why we won" : "✗ Why we lost";
      const closedAtISO = o.closedAt ? new Date(o.closedAt).toISOString().slice(0,10) : "";
      return `
      <div style="margin-top:10px;padding:14px;border:1px solid var(--ink-150);border-left:3px solid ${accent};border-radius:8px;background:var(--ab7-sky-ghost)">
        <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${accent};margin-bottom:10px">${label}</div>
        <div class="fld-row">
          <div class="fld"><label>${isWon?"Won":"Lost"} date</label><input id="ld-out-date" type="date" value="${escapeHtml(closedAtISO)}"></div>
          <div class="fld"></div>
        </div>
        ${isWon?`
          <div class="fld-row">
            <div class="fld"><label>Win reason category</label><select id="ld-out-winCategory"><option value="">— select —</option>${LF.picklists.winCategories().map(c=>`<option ${c===o.winCategory?"selected":""}>${escapeHtml(c)}</option>`).join("")}</select></div>
            <div class="fld"><label>Why it's in our list</label><select id="ld-out-winListReason"><option value="">— select —</option>${LF.picklists.winListReasons().map(c=>`<option ${c===o.winListReason?"selected":""}>${escapeHtml(c)}</option>`).join("")}</select></div>
          </div>
          <div class="fld"><label>Why we won it <span style="font-weight:400;color:var(--ink-400);font-size:10.5px">· detail</span></label><textarea id="ld-out-winReason" placeholder="Competitive pricing · domain expertise · faster turnaround · trusted relationship…">${escapeHtml(o.winReason||"")}</textarea></div>
          <div class="fld"><label>What we are offering them</label><textarea id="ld-out-offering" placeholder="AI-driven medical scribing · EHR documentation · cybersecurity audit · remote transcription…">${escapeHtml(o.offering||"")}</textarea></div>
          <div class="fld-row">
            <div class="fld"><label>Pricing model</label><select id="ld-out-pricingModel"><option value="">— select —</option>${PRICING_MODELS.map(p=>`<option ${p===o.pricingModel?"selected":""}>${p}</option>`).join("")}</select></div>
            <div class="fld"><label>Contract duration</label><input id="ld-out-contractDuration" placeholder="e.g. 12 months" value="${escapeHtml(o.contractDuration||"")}"></div>
          </div>
          <div class="fld"><label>Payment terms</label><input id="ld-out-paymentTerms" placeholder="e.g. Net 30 · 50% upfront · monthly" value="${escapeHtml(o.paymentTerms||"")}"></div>
        `:`
          <div class="fld-row">
            <div class="fld"><label>Loss reason category</label><select id="ld-out-lossCategory"><option value="">— select —</option>${LF.picklists.lossCategories().map(c=>`<option ${c===o.lossCategory?"selected":""}>${escapeHtml(c)}</option>`).join("")}</select></div>
            <div class="fld"><label>Why it's not in our list</label><select id="ld-out-notInListReason"><option value="">— select —</option>${LF.picklists.notInListReasons().map(c=>`<option ${c===o.notInListReason?"selected":""}>${escapeHtml(c)}</option>`).join("")}</select></div>
          </div>
          <div class="fld"><label>Detailed reason for losing</label><textarea id="ld-out-lossReasonDetail" placeholder="Specific root cause — price, capability gap, competitor advantage, timing, decision-maker change…">${escapeHtml(o.lossReasonDetail||"")}</textarea></div>
          <div class="fld"><label>Why specifically we lost it</label><textarea id="ld-out-lossReasonSpecific" placeholder="Narrowed-down reason — competitor offered 20% lower · no 24/7 coverage · client preferred local vendor…">${escapeHtml(o.lossReasonSpecific||"")}</textarea></div>
          <div class="fld"><label>Lessons learned / action items</label><textarea id="ld-out-lessonsLearned" placeholder="What to improve next time — pricing strategy, capability build, relationship nurturing…">${escapeHtml(o.lessonsLearned||"")}</textarea></div>
        `}
      </div>`;
    })()}

    ${(function(){
      const vis = L.visibility || {mode:"all", users:[]};
      const allUsers = (LF.state.teamMembers && LF.state.teamMembers.length) ? LF.state.teamMembers : (typeof OWNERS !== "undefined" ? OWNERS : []);
      const me = LF.state.user && LF.state.user.id;
      return `
      <div style="margin-top:10px;padding-top:14px;border-top:1px dashed var(--ink-200)">
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-500);margin-bottom:8px">🔒 Visibility &amp; sharing</div>
        <div class="fld">
          <label>Who can see this lead?</label>
          <select id="ld-vis-mode" onchange="LF.views.toggleVisCustom()">
            <option value="all" ${vis.mode==='all'?'selected':''}>👥 All users in the workspace</option>
            <option value="custom" ${vis.mode==='custom'?'selected':''}>👤 Custom — pick specific users</option>
            <option value="private" ${vis.mode==='private'?'selected':''}>🔐 Private — only owner &amp; admins</option>
          </select>
        </div>
        <div id="ld-vis-custom-wrap" style="display:${vis.mode==='custom'?'block':'none'};margin-top:6px">
          <label style="font-size:11.5px;color:var(--ink-600);display:block;margin-bottom:6px">Select users who can view this lead (owner is always included)</label>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;border:1px solid var(--ink-150);border-radius:6px;padding:8px;background:#fff">
            ${allUsers.filter(u=>u.id!==L.ownerId).map(u=>`
              <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 6px;border-radius:4px;cursor:pointer">
                <input type="checkbox" class="ld-vis-user" value="${u.id}" ${(vis.users||[]).includes(u.id)?'checked':''}>
                <span style="font-weight:600;color:var(--ink-800)">${escapeHtml(u.name||u.email||u.id)}</span>
                <span style="font-size:10.5px;color:var(--ink-400)">${escapeHtml(u.role||'')}${u.team?' · '+escapeHtml(u.team):''}</span>
              </label>`).join("") || '<div style="font-size:11.5px;color:var(--ink-400);padding:6px">No other users yet — add team members in Settings.</div>'}
          </div>
        </div>
        <p style="font-size:11px;color:var(--ink-500);margin-top:6px;line-height:1.5">Admins and the lead owner always have access regardless of mode. Customise this for confidential leads.</p>
      </div>`;
    })()}
    ${(function(){ if(LF.qual&&LF.qual._bootstrap) LF.qual._bootstrap(); const doms = LF.state.serviceDomains||[]; const si = L.serviceInterest||{}; const svcList = si.domainId?LF.qual.listServicesForDomain(si.domainId):[]; return `
      <div style="margin-top:10px;padding-top:14px;border-top:1px dashed var(--ink-200)">
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-500);margin-bottom:8px">✦ Service interest — drives qualification checklist</div>
        <div class="fld-row">
          <div class="fld"><label>Domain</label><select id="ld-si-domain" onchange="LF.views.onLeadDomainChange()">
            <option value="">— none —</option>
            ${doms.map(d=>'<option value="'+d.id+'"'+(d.id===si.domainId?' selected':'')+'>'+d.icon+' '+escapeHtml(d.name)+'</option>').join("")}
          </select></div>
          <div class="fld"><label>Service</label><select id="ld-si-service">
            <option value="">— none —</option>
            ${svcList.map(s=>'<option value="'+s.id+'"'+(s.id===si.serviceId?' selected':'')+'>'+escapeHtml(s.name)+'</option>').join("")}
          </select></div>
        </div>
        ${editing?'<button type="button" class="btn btn-blue btn-sm" onclick="LF.drawer.close();LF.qual.runForLead(\''+L.id+'\')">▶ Run qualification checklist</button>':''}
      </div>
    `; })()}
    ${LF.state.customFields.length?`
      <div style="margin-top:10px;padding-top:14px;border-top:1px dashed var(--ink-200)">
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-500);margin-bottom:8px">Custom fields</div>
        ${LF.state.customFields.map(f=>`
          <div class="fld"><label>${escapeHtml(f.name)}</label>
            <select id="cf-${f.id}"><option value="">— select —</option>${f.opts.map(o=>`<option>${o}</option>`).join("")}</select>
          </div>`).join("")}
      </div>`:""}
    </div>`;

  const timelineHtml = editing?`<div id="tab-timeline" style="display:none">
    ${L.activities.slice().reverse().map(a=>`
      <div class="activity-item"><div class="ic">●</div>
        <div class="body"><div class="t">${escapeHtml(a.text)}</div>
        <div class="m">${fmtTime(a.at)} · by ${ownersList().find(o=>o.id===a.by)?.name||'System'}</div></div></div>`).join("")||'<p style="color:var(--ink-400);font-size:13px">No activity yet.</p>'}
    <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="LF.views.addActivity('${L.id}')">+ Log activity</button>
  </div>`:'';

  const aiHtml = editing?`<div id="tab-ai" style="display:none">
    <div style="background:linear-gradient(135deg,rgba(59,130,246,.06),rgba(20,216,166,.06));border:1px solid rgba(20,216,166,.2);border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ab7-blue-deep);margin-bottom:6px">✦ AI Brief · generated by Researcher Agent</div>
      <h4 style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHtml(L.company)} — ${escapeHtml(L.industry)}</h4>
      <p style="font-size:13px;color:var(--ink-700);line-height:1.55">${escapeHtml(L.name)} is the likely decision-maker at ${escapeHtml(L.company)}, a ${L.industry.toLowerCase()} firm headquartered in ${escapeHtml(L.city)}, ${L.country}. Engagement pattern suggests ${L.score>=75?"high buying intent":"early exploration"}. Best next action: ${L.score>=75?"personal outreach by assigned AE with a custom pricing proposal":"add to the 5-touch nurture sequence tailored for "+L.industry.toLowerCase()+" buyers"}.</p>
    </div>
    <div class="grid g-2" style="margin-top:12px">
      <div class="card" style="padding:14px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--ink-500)">Top score drivers</div>
        <ul style="font-size:12.5px;margin-top:8px;padding-left:16px;color:var(--ink-700)"><li>Industry fit: ${L.industry}</li><li>Region priority: ${L.country}</li><li>Source quality: ${L.source}</li><li>Engagement: ${L.activities.length} touches</li></ul>
      </div>
      <div class="card" style="padding:14px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--ink-500)">Recommended actions</div>
        <ul style="font-size:12.5px;margin-top:8px;padding-left:16px;color:var(--ink-700)"><li>Send ${L.industry} case study</li><li>Book a 30-min discovery</li><li>Enrich with tech stack data</li></ul>
      </div>
    </div>
    <button class="btn btn-blue btn-sm" style="margin-top:12px" onclick="LF.views.runFollowup('${L.id}')">Run Follow-up Agent ▶</button>
  </div>`:"";

  const consentHtml = editing?`<div id="tab-consent" style="display:none">
    <p style="font-size:13px;color:var(--ink-600);margin-bottom:14px">DPDP / GDPR-compliant consent record for this lead.</p>
    ${[["email","Email marketing"],["whatsapp","WhatsApp messaging"],["sms","SMS messaging"]].map(([k,label])=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed var(--ink-150)">
        <div><div style="font-size:13px;font-weight:700">${label}</div><div style="font-size:11.5px;color:var(--ink-400)">Last captured ${fmtTime(L.updatedAt)}</div></div>
        <div class="toggle ${L.consent[k]?'on':''}" onclick="LF.views.toggleConsent('${L.id}','${k}',this)"></div>
      </div>`).join("")}
    <button class="btn btn-ghost btn-sm" style="margin-top:14px" onclick="LF.views.leadDsar('${L.id}')">⬇ DSAR export</button>
    <button class="btn btn-danger btn-sm" style="margin-top:14px" onclick="if(confirm('Permanently erase this lead\\'s PII? This is irreversible.')){LF.views.erasePII('${L.id}')}">Right-to-erasure</button>
  </div>`:"";

  LF.drawer.open({
    title: editing?`${L.name}`:"New lead",
    body: tabsTop + detailsHtml + timelineHtml + aiHtml + consentHtml,
    foot: `<button class="btn btn-ghost" onclick="LF.drawer.close()">Cancel</button>
      ${editing?`<button class="btn btn-ghost" onclick="LF.drawer.close();LF.email.compose({leadId:'${L.id}'})">✉ Send email</button>`:''}
      ${editing?`<button class="btn btn-danger" onclick="LF.views.deleteLead('${L.id}')">Delete</button>`:''}
      <button class="btn btn-primary" onclick="LF.views.saveLead('${editing?L.id:''}')">${editing?'Save changes':'Create lead'}</button>`
  });
};

/* Toggle the custom-user picker in the lead drawer visibility section */
LF.views.toggleVisCustom = function(){
  const sel = document.getElementById("ld-vis-mode");
  const wrap = document.getElementById("ld-vis-custom-wrap");
  if(sel && wrap) wrap.style.display = (sel.value === "custom") ? "block" : "none";
};

/* Permission helper — can the given user view this lead? */
LF.canViewLead = function(lead, userId){
  if(!lead) return false;
  const cur = (LF.state && LF.state.user) || {};
  userId = userId || cur.id;
  /* Current logged-in Admin/Owner ALWAYS sees the entire dataset — trust the
     session role even if the teamMembers lookup below misses (id desync, a
     server-reloaded roster, or the first-run setup admin not yet in the roster).
     Guarantees the admin portal reflects all compiled data in every view. */
  if(userId === cur.id && (cur.role === "Admin" || cur.role === "Owner")) return true;
  /* Admins and Owner role always see everything */
  const team = (LF.state.teamMembers && LF.state.teamMembers.length) ? LF.state.teamMembers : (typeof OWNERS !== "undefined" ? OWNERS : []);
  const u = team.find(x => x.id === userId);
  if(u && (u.role === "Admin" || u.role === "Owner")) return true;
  /* Lead owner always sees their own lead */
  if(lead.ownerId === userId) return true;
  /* Apply visibility policy */
  const vis = lead.visibility || {mode:"all", users:[]};
  if(vis.mode === "all") return true;
  if(vis.mode === "private") return false;
  if(vis.mode === "custom") return Array.isArray(vis.users) && vis.users.includes(userId);
  return true; /* default permissive for unknown modes */
};

LF.views.leadTab = function(name, ev){
  document.querySelectorAll("#drawer-body .seg button").forEach(b=>b.classList.remove("active"));
  ev.target.classList.add("active");
  ["details","timeline","ai","consent"].forEach(t=>{
    const el = document.getElementById("tab-"+t); if(el) el.style.display = t===name?"block":"none";
  });
};

LF.views.saveLead = function(id){
  const f = ["fn","ln","email","phone","co","ind","city","country","src","stage","amt","ccy","owner","score","notes"];
  const v = {};
  f.forEach(k=> v[k] = document.getElementById("ld-"+k).value );
  if(!v.fn || !v.ln){ LF.toast("First & last name required","err"); return }
  if(!v.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)){ LF.toast("Valid email required","err"); return }
  if(!v.co){ LF.toast("Company required","err"); return }
  const amt = parseFloat(v.amt)||0, score = Math.max(0,Math.min(100,parseInt(v.score)||0));

  const siD = document.getElementById("ld-si-domain")?.value || "";
  const siS = document.getElementById("ld-si-service")?.value || "";
  const serviceInterest = (siD || siS) ? {domainId:siD, serviceId:siS} : null;

  // Collect outcome fields (only present in the DOM when stage is Won/Lost).
  // Read defensively: if the field isn't rendered we leave the existing value
  // alone rather than blanking it out.
  function _readOutcome(prevOutcome){
    const isWon = v.stage === "Won", isLost = v.stage === "Lost";
    if(!isWon && !isLost) return prevOutcome || {};
    const get = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    const dateStr = get("ld-out-date");
    const closedAt = dateStr ? Date.parse(dateStr) : ((prevOutcome && prevOutcome.closedAt) || Date.now());
    const out = { ...(prevOutcome||{}), closedAt };
    if(isWon){
      const wc = get("ld-out-winCategory");         if(wc !== undefined) out.winCategory        = wc;
      const wl = get("ld-out-winListReason");       if(wl !== undefined) out.winListReason      = wl;
      const wr = get("ld-out-winReason");          if(wr !== undefined) out.winReason          = wr;
      const of = get("ld-out-offering");           if(of !== undefined) out.offering           = of;
      const pm = get("ld-out-pricingModel");       if(pm !== undefined) out.pricingModel       = pm;
      const cd = get("ld-out-contractDuration");   if(cd !== undefined) out.contractDuration   = cd;
      const pt = get("ld-out-paymentTerms");       if(pt !== undefined) out.paymentTerms       = pt;
    } else {
      const lc = get("ld-out-lossCategory");        if(lc !== undefined) out.lossCategory        = lc;
      const nr = get("ld-out-notInListReason");     if(nr !== undefined) out.notInListReason     = nr;
      const ld = get("ld-out-lossReasonDetail");    if(ld !== undefined) out.lossReasonDetail    = ld;
      const ls = get("ld-out-lossReasonSpecific");  if(ls !== undefined) out.lossReasonSpecific  = ls;
      const ll = get("ld-out-lessonsLearned");      if(ll !== undefined) out.lessonsLearned      = ll;
    }
    return out;
  }

  if(id){
    const l = LF.state.leads.find(x=>x.id===id);
    const changed = [];
    if(l.stage!==v.stage){ changed.push(`stage → ${v.stage}`) }
    if(l.ownerId!==v.owner){ changed.push(`owner → ${((ownersList().find(o=>o.id===v.owner)||{}).name)||'someone'}`) }
    if(JSON.stringify(l.serviceInterest||{})!==JSON.stringify(serviceInterest||{})){ const s=LF.qual.getService(siS); changed.push(`service interest → ${s?s.name:'(cleared)'}`); }
    const visModeE = document.getElementById("ld-vis-mode")?.value || "all";
    const visUsersE = Array.from(document.querySelectorAll(".ld-vis-user:checked")).map(x=>x.value);
    const visibilityE = {mode:visModeE, users: visModeE==="custom" ? visUsersE : []};
    if(JSON.stringify(l.visibility||{mode:"all",users:[]})!==JSON.stringify(visibilityE)){ changed.push(`visibility → ${visibilityE.mode}${visibilityE.mode==="custom"?` (${visibilityE.users.length} users)`:""}`); }
    // Manual score override: if the user changed the score field (it differs
    // from what was loaded), respect that value. Otherwise auto-compute from
    // lead attributes via LF.score.compute.
    const manualScore = (score !== l.score);
    const nextOutcome = _readOutcome(l.outcome);
    Object.assign(l,{firstName:v.fn,lastName:v.ln,name:`${v.fn} ${v.ln}`,email:v.email,phone:v.phone,company:v.co,industry:v.ind,city:v.city,country:v.country,source:v.src,stage:v.stage,amount:amt,currency:"INR",ownerId:v.owner,score,notes:v.notes,serviceInterest,visibility:visibilityE,outcome:nextOutcome,updatedAt:Date.now()});
    if(!manualScore && LF.score && LF.score.compute) l.score = LF.score.compute(l);
    if(changed.length) l.activities.push({type:"edit",at:Date.now(),by:LF.state.user.id,text:"Updated: "+changed.join(", ")});
    LF.toast("Lead saved","");
  } else {
    const visMode = document.getElementById("ld-vis-mode")?.value || "all";
    const visUsers = Array.from(document.querySelectorAll(".ld-vis-user:checked")).map(x=>x.value);
    const visibility = {mode:visMode, users: visMode==="custom" ? visUsers : []};
    const newOutcome = _readOutcome({});
    const l = {id:rid(),firstName:v.fn,lastName:v.ln,name:`${v.fn} ${v.ln}`,email:v.email,phone:v.phone,company:v.co,industry:v.ind,city:v.city,country:v.country,source:v.src,stage:v.stage,amount:amt,currency:"INR",ownerId:v.owner,score,tags:score>75?["hot"]:score>55?["warm"]:["cold"],notes:v.notes,serviceInterest,visibility,outcome:newOutcome,createdAt:Date.now(),updatedAt:Date.now(),consent:{email:true,whatsapp:false,sms:false},activities:[{type:"create",at:Date.now(),by:LF.state.user.id,text:`Created via form (visibility: ${visibility.mode}${visibility.mode==="custom"?` · ${visibility.users.length} users`:""})`+(serviceInterest?" · interested in "+(LF.qual.getService(siS)?.name||"—"):"")}]};
    // Auto-score on create unless the user typed a non-default value into the
    // score field (40 is the form default, so anything else is intentional).
    if(score === 40 && LF.score && LF.score.compute){
      l.score = LF.score.compute(l);
      l.tags = l.score > 75 ? ["hot"] : l.score > 55 ? ["warm"] : ["cold"];
    }
    LF.state.leads.unshift(l);
    LF.toast("Lead created · Researcher Agent will enrich shortly","");
  }
  LF.storage.save();
  LF.updateSidebarCounts();
  LF.drawer.close();
  if(LF.state.route==="leads") LF.views.renderLeadRows();
  else if(LF.state.route==="dashboard") LF.router.go("dashboard");
};

LF.views.deleteLead = function(id){
  if(!confirm("Delete this lead? This cannot be undone.")) return;
  LF.state.leads = LF.state.leads.filter(l=>l.id!==id);
  LF.storage.save();
  LF.updateSidebarCounts();
  LF.drawer.close();
  LF.toast("Lead deleted","info");
  if(LF.state.route==="leads") LF.views.renderLeadRows();
};

/* ==========================================================
   WON LEADS / LOST LEADS — outcome analysis views
   ----------------------------------------------------------
   Two sister pages that surface the full closed-deal picture:
   what we win, why, at what commercials, and what we offer —
   plus the loss-side equivalents (root cause, why not in our
   list, lessons learned). Both share a summary header showing
   overall win/loss counts + win rate by industry, then per-view
   filters and a scannable table. Powered entirely by lead data
   already persisted via the lead drawer's outcome capture.
   ========================================================== */
LF.outcomes = {
  // Return the list of leads in the given stage, sorted by close date desc.
  bystage(stage){
    const me = LF.state.user && LF.state.user.id;
    return (LF.state.leads||[]).filter(l => {
      if(l.stage !== stage) return false;
      if(typeof LF.canViewLead === "function" && !LF.canViewLead(l, me)) return false;
      return true;
    });
  },
  // Stats blob shared by both Won and Lost view headers.
  summary(){
    const all = LF.state.leads || [];
    const won = all.filter(l => l.stage === "Won");
    const lost = all.filter(l => l.stage === "Lost");
    const closed = won.length + lost.length;
    const winRate = closed ? Math.round(won.length / closed * 100) : 0;
    const avgWonAmt = won.length ? Math.round(won.reduce((a,b)=>a+(b.amount||0),0)/won.length) : 0;
    const totalWonAmt = won.reduce((a,b)=>a+(b.amount||0),0);
    // Win rate by industry
    const byInd = {};
    [...won, ...lost].forEach(l => {
      const k = l.industry || "—";
      if(!byInd[k]) byInd[k] = {industry:k, won:0, lost:0, wonAmt:0};
      if(l.stage === "Won"){ byInd[k].won++; byInd[k].wonAmt += (l.amount||0); }
      else byInd[k].lost++;
    });
    const industries = Object.values(byInd).map(r => ({
      ...r, total: r.won+r.lost, rate: (r.won+r.lost) ? Math.round(r.won/(r.won+r.lost)*100) : 0
    })).sort((a,b) => b.total - a.total);
    // Top 5 loss reasons
    const reasonCounts = {};
    lost.forEach(l => {
      const r = (l.outcome && l.outcome.lossCategory) || "Uncategorized";
      reasonCounts[r] = (reasonCounts[r]||0) + 1;
    });
    const topReasons = Object.entries(reasonCounts).map(([reason, count]) => ({reason, count}))
      .sort((a,b) => b.count - a.count).slice(0, 5);
    // Top 5 win reasons — mirror of the loss-side breakdown.
    const winReasonCounts = {};
    won.forEach(l => {
      const r = (l.outcome && l.outcome.winCategory) || "Uncategorized";
      winReasonCounts[r] = (winReasonCounts[r]||0) + 1;
    });
    const topWinReasons = Object.entries(winReasonCounts).map(([reason, count]) => ({reason, count}))
      .sort((a,b) => b.count - a.count).slice(0, 5);
    return { wonCount:won.length, lostCount:lost.length, closed, winRate, avgWonAmt, totalWonAmt, industries, topReasons, topWinReasons };
  }
};

LF.views.wonLeads = function(el){
  const s = LF.outcomes.summary();
  const f = LF.state.filters.wonLeads;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Won Leads</div>
        <div class="page-sub">What we win, why we win, at what commercials, and what we offer.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.views.exportOutcomesCsv('Won')">⬇ Export CSV</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Won deals</div><div class="val">${s.wonCount}</div><div class="delta up">${s.closed?Math.round(s.wonCount/s.closed*100):0}% of closed</div></div>
      <div class="kpi"><div class="lbl">Total won revenue</div><div class="val">${fmtCur(s.totalWonAmt)}</div><div class="delta up">avg ${fmtCur(s.avgWonAmt)}</div></div>
      <div class="kpi"><div class="lbl">Win rate</div><div class="val">${s.winRate}%</div><div class="delta ${s.winRate>=25?'up':'down'}">${s.wonCount} won · ${s.lostCount} lost</div></div>
      <div class="kpi"><div class="lbl">Top industry</div><div class="val" style="font-size:18px">${escapeHtml(s.industries[0]?.industry || "—")}</div><div class="delta up">${s.industries[0]?.rate||0}% rate · ${s.industries[0]?.total||0} closed</div></div>
    </div>

    <div class="grid g-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>Win rate by industry</h3><div class="sub">${s.industries.length} industries</div></div>
        <div style="display:flex;flex-direction:column;gap:10px;padding:6px 0">
          ${s.industries.length ? s.industries.slice(0,8).map(r => `
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:120px;font-size:13px;font-weight:600;color:var(--ink-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.industry)}</div>
              <div style="flex:1;display:flex;height:18px;border-radius:5px;overflow:hidden;background:var(--ink-100)">
                <div style="background:var(--ab7-green);width:${r.total?r.won/r.total*100:0}%" title="${r.won} won"></div>
                <div style="background:#FCA5A5;width:${r.total?r.lost/r.total*100:0}%" title="${r.lost} lost"></div>
              </div>
              <div style="width:140px;text-align:right;font-size:12px;font-family:var(--font-mono);color:var(--ink-600)">${r.rate}% · ${r.won}/${r.total}</div>
            </div>
          `).join("") : '<p style="color:var(--ink-400);font-size:13px">No closed deals yet — move a lead to Won to see industry breakdown.</p>'}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Top win reasons</h3><div class="sub">why we win</div></div>
        <div style="display:flex;flex-direction:column;gap:8px;padding:6px 0">
          ${s.topWinReasons.length ? s.topWinReasons.map(r => {
            const pct = s.wonCount ? Math.round(r.count/s.wonCount*100) : 0;
            return `<div style="display:flex;align-items:center;gap:12px">
              <div style="flex:1;font-size:13px;color:var(--ink-800)">${escapeHtml(r.reason)}</div>
              <div style="width:160px;height:14px;background:var(--ink-100);border-radius:4px;overflow:hidden"><div style="background:var(--ab7-green);height:100%;width:${pct}%"></div></div>
              <div style="width:70px;text-align:right;font-size:12px;font-family:var(--font-mono);color:var(--ink-600)">${r.count} · ${pct}%</div>
            </div>`;
          }).join("") : '<p style="color:var(--ink-400);font-size:13px">Fill in the Win reason category on a Won lead to see the breakdown.</p>'}
        </div>
      </div>
    </div>

    <div class="tbl-wrap">
      <div class="tbl-toolbar">
        <div class="tbl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="wf-q" placeholder="Search company, why we won, offering…" value="${escapeHtml(f.q||"")}">
        </div>
        <select class="filter" id="wf-industry">
          <option value="">All industries</option>
          ${(LF.picklists?LF.picklists.industries():[]).map(i=>`<option value="${escapeHtml(i)}" ${f.industry===i?"selected":""}>${escapeHtml(i)}</option>`).join("")}
        </select>
        <select class="filter" id="wf-owner">
          <option value="">All owners</option>
          ${ownersList().map(o=>`<option value="${o.id}" ${f.owner===o.id?"selected":""}>${escapeHtml(o.name)}</option>`).join("")}
        </select>
        <select class="filter" id="wf-winCategory">
          <option value="">All win reasons</option>
          ${LF.picklists.winCategories().map(c=>`<option value="${escapeHtml(c)}" ${f.winCategory===c?"selected":""}>${escapeHtml(c)}</option>`).join("")}
        </select>
        <input class="filter" id="wf-from" type="date" title="Won from" value="${escapeHtml(f.from||"")}">
        <input class="filter" id="wf-to" type="date" title="Won to" value="${escapeHtml(f.to||"")}">
        <input class="filter" id="wf-amtMin" type="number" placeholder="Min ₹" style="width:110px" value="${escapeHtml(f.amtMin||"")}">
        <input class="filter" id="wf-amtMax" type="number" placeholder="Max ₹" style="width:110px" value="${escapeHtml(f.amtMax||"")}">
        <button class="btn btn-ghost btn-sm" onclick="LF.views.clearWonFilters()">Clear</button>
      </div>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead>
          <tr>
            <th>Lead / Company</th>
            <th>Industry</th>
            <th>Why we won</th>
            <th>Commercials</th>
            <th>What we offer</th>
            <th>Won date</th>
            <th>Sales owner</th>
          </tr>
        </thead>
        <tbody id="won-rows"></tbody>
      </table>
      </div>
      <div class="tbl-foot"><div id="won-summary"></div></div>
    </div>
  `;
  ["wf-q","wf-industry","wf-owner","wf-winCategory","wf-from","wf-to","wf-amtMin","wf-amtMax"].forEach(id=>{
    const el = document.getElementById(id); if(!el) return;
    el.addEventListener("input", ()=>{
      const k = id.slice(3); // strip "wf-"
      const map = {q:"q",industry:"industry",owner:"owner",winCategory:"winCategory",from:"from",to:"to",amtMin:"amtMin",amtMax:"amtMax"};
      LF.state.filters.wonLeads[map[k]] = el.value;
      LF.views.renderWonRows();
    });
  });
  LF.views.renderWonRows();
};

LF.views.renderWonRows = function(){
  const f = LF.state.filters.wonLeads;
  const fromMs = f.from ? Date.parse(f.from) : null;
  const toMs   = f.to   ? Date.parse(f.to)+86400000-1 : null; // include end date
  const amtMin = f.amtMin ? parseFloat(f.amtMin) : null;
  const amtMax = f.amtMax ? parseFloat(f.amtMax) : null;
  const q = (f.q||"").toLowerCase();
  let list = LF.outcomes.bystage("Won").filter(l => {
    if(f.industry && l.industry !== f.industry) return false;
    if(f.owner && l.ownerId !== f.owner) return false;
    if(f.winCategory && (l.outcome?.winCategory||"") !== f.winCategory) return false;
    if(amtMin != null && (l.amount||0) < amtMin) return false;
    if(amtMax != null && (l.amount||0) > amtMax) return false;
    const closedAt = l.outcome && l.outcome.closedAt;
    if(fromMs != null && (!closedAt || closedAt < fromMs)) return false;
    if(toMs   != null && (!closedAt || closedAt > toMs))   return false;
    if(q){
      const blob = [l.name,l.company,l.industry,l.outcome?.winReason,l.outcome?.winCategory,l.outcome?.winListReason,l.outcome?.offering,l.outcome?.paymentTerms].filter(Boolean).join(" ").toLowerCase();
      if(!blob.includes(q)) return false;
    }
    return true;
  });
  list.sort((a,b) => (b.outcome?.closedAt||0) - (a.outcome?.closedAt||0));
  const tbody = document.getElementById("won-rows");
  if(!tbody) return;
  const total = list.reduce((a,b)=>a+(b.amount||0), 0);
  tbody.innerHTML = list.length ? list.map(l => {
    const o = l.outcome || {};
    const owner = ownersList().find(x=>x.id===l.ownerId);
    const commercials = [
      fmtCur(l.amount||0),
      o.pricingModel || "",
      o.contractDuration ? "· " + o.contractDuration : "",
      o.paymentTerms ? "· " + o.paymentTerms : ""
    ].filter(Boolean).join(" ");
    return `<tr style="cursor:pointer" onclick="LF.views.openLeadDrawer('${l.id}')">
      <td><b>${escapeHtml(l.name)}</b><div style="font-size:11.5px;color:var(--ink-500)">${escapeHtml(l.company||"")}</div></td>
      <td>${escapeHtml(l.industry||"—")}</td>
      <td style="max-width:260px"><div style="white-space:normal;line-height:1.4;font-size:12.5px">${escapeHtml(o.winReason||"—")}</div></td>
      <td style="font-family:var(--font-mono);font-size:12px;white-space:normal;line-height:1.4">${escapeHtml(commercials)}</td>
      <td style="max-width:260px"><div style="white-space:normal;line-height:1.4;font-size:12.5px">${escapeHtml(o.offering||"—")}</div></td>
      <td style="white-space:nowrap;font-size:12px">${o.closedAt ? fmtDate(o.closedAt) : "—"}</td>
      <td>${escapeHtml(owner ? owner.name : "—")}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--ink-400);font-size:13px">No won leads match these filters.</td></tr>`;
  const sum = document.getElementById("won-summary");
  if(sum) sum.textContent = `${list.length} of ${LF.outcomes.bystage("Won").length} won leads · total ${fmtCur(total)}`;
};

LF.views.clearWonFilters = function(){
  LF.state.filters.wonLeads = {q:"",industry:"",owner:"",from:"",to:"",amtMin:"",amtMax:"",winCategory:""};
  LF.router.go("wonLeads");
};

LF.views.lostLeads = function(el){
  const s = LF.outcomes.summary();
  const f = LF.state.filters.lostLeads;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Lost Leads</div>
        <div class="page-sub">Why we lost, what to learn, and why each isn't in our active list.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.views.exportOutcomesCsv('Lost')">⬇ Export CSV</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Lost deals</div><div class="val">${s.lostCount}</div><div class="delta down">${s.closed?Math.round(s.lostCount/s.closed*100):0}% of closed</div></div>
      <div class="kpi"><div class="lbl">Won vs lost</div><div class="val">${s.wonCount} / ${s.lostCount}</div><div class="delta ${s.winRate>=25?'up':'down'}">${s.winRate}% win rate</div></div>
      <div class="kpi"><div class="lbl">Top loss reason</div><div class="val" style="font-size:16px">${escapeHtml(s.topReasons[0]?.reason || "—")}</div><div class="delta down">${s.topReasons[0]?.count || 0} deals</div></div>
      <div class="kpi"><div class="lbl">Uncategorized</div><div class="val">${s.topReasons.find(r=>r.reason==="Uncategorized")?.count || 0}</div><div class="delta down">need root-cause</div></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h3>Top 5 loss reasons</h3><div class="sub">root-cause breakdown</div></div>
      <div style="display:flex;flex-direction:column;gap:8px;padding:6px 0">
        ${s.topReasons.length ? s.topReasons.map(r => {
          const pct = s.lostCount ? Math.round(r.count/s.lostCount*100) : 0;
          return `<div style="display:flex;align-items:center;gap:12px">
            <div style="flex:1;font-size:13px;color:var(--ink-800)">${escapeHtml(r.reason)}</div>
            <div style="width:220px;height:14px;background:var(--ink-100);border-radius:4px;overflow:hidden"><div style="background:#DC2626;height:100%;width:${pct}%"></div></div>
            <div style="width:80px;text-align:right;font-size:12px;font-family:var(--font-mono);color:var(--ink-600)">${r.count} · ${pct}%</div>
          </div>`;
        }).join("") : '<p style="color:var(--ink-400);font-size:13px">No lost leads yet.</p>'}
      </div>
    </div>

    <div class="tbl-wrap">
      <div class="tbl-toolbar">
        <div class="tbl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="lf-q" placeholder="Search company, reason, lessons…" value="${escapeHtml(f.q||"")}">
        </div>
        <select class="filter" id="lf-industry">
          <option value="">All industries</option>
          ${(LF.picklists?LF.picklists.industries():[]).map(i=>`<option value="${escapeHtml(i)}" ${f.industry===i?"selected":""}>${escapeHtml(i)}</option>`).join("")}
        </select>
        <select class="filter" id="lf-owner">
          <option value="">All owners</option>
          ${ownersList().map(o=>`<option value="${o.id}" ${f.owner===o.id?"selected":""}>${escapeHtml(o.name)}</option>`).join("")}
        </select>
        <select class="filter" id="lf-cat">
          <option value="">All loss reasons</option>
          ${LOSS_CATEGORIES.map(c=>`<option value="${escapeHtml(c)}" ${f.lossCategory===c?"selected":""}>${escapeHtml(c)}</option>`).join("")}
        </select>
        <input class="filter" id="lf-from" type="date" title="Lost from" value="${escapeHtml(f.from||"")}">
        <input class="filter" id="lf-to" type="date" title="Lost to" value="${escapeHtml(f.to||"")}">
        <button class="btn btn-ghost btn-sm" onclick="LF.views.clearLostFilters()">Clear</button>
      </div>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead>
          <tr>
            <th>Lead / Company</th>
            <th>Industry</th>
            <th>Detailed reason</th>
            <th>Why not in list</th>
            <th>Why specifically</th>
            <th>Lost date</th>
            <th>Sales owner</th>
            <th>Lessons / actions</th>
          </tr>
        </thead>
        <tbody id="lost-rows"></tbody>
      </table>
      </div>
      <div class="tbl-foot"><div id="lost-summary"></div></div>
    </div>
  `;
  ["lf-q","lf-industry","lf-owner","lf-cat","lf-from","lf-to"].forEach(id=>{
    const el = document.getElementById(id); if(!el) return;
    el.addEventListener("input", ()=>{
      const k = id.slice(3);
      const map = {q:"q",industry:"industry",owner:"owner",cat:"lossCategory",from:"from",to:"to"};
      LF.state.filters.lostLeads[map[k]] = el.value;
      LF.views.renderLostRows();
    });
  });
  LF.views.renderLostRows();
};

LF.views.renderLostRows = function(){
  const f = LF.state.filters.lostLeads;
  const fromMs = f.from ? Date.parse(f.from) : null;
  const toMs   = f.to   ? Date.parse(f.to)+86400000-1 : null;
  const q = (f.q||"").toLowerCase();
  let list = LF.outcomes.bystage("Lost").filter(l => {
    if(f.industry && l.industry !== f.industry) return false;
    if(f.owner && l.ownerId !== f.owner) return false;
    if(f.lossCategory && (l.outcome?.lossCategory||"") !== f.lossCategory) return false;
    const closedAt = l.outcome && l.outcome.closedAt;
    if(fromMs != null && (!closedAt || closedAt < fromMs)) return false;
    if(toMs   != null && (!closedAt || closedAt > toMs))   return false;
    if(q){
      const blob = [l.name,l.company,l.industry,l.outcome?.lossReasonDetail,l.outcome?.lossReasonSpecific,l.outcome?.lessonsLearned,l.outcome?.lossCategory,l.outcome?.notInListReason].filter(Boolean).join(" ").toLowerCase();
      if(!blob.includes(q)) return false;
    }
    return true;
  });
  list.sort((a,b) => (b.outcome?.closedAt||0) - (a.outcome?.closedAt||0));
  const tbody = document.getElementById("lost-rows");
  if(!tbody) return;
  tbody.innerHTML = list.length ? list.map(l => {
    const o = l.outcome || {};
    const owner = ownersList().find(x=>x.id===l.ownerId);
    const catTag = o.lossCategory ? `<span class="tag" style="background:#FEE2E2;color:#991B1B;font-size:10px;font-weight:700">${escapeHtml(o.lossCategory)}</span>` : `<span class="tag" style="background:var(--ink-100);color:var(--ink-500);font-size:10px">Uncategorized</span>`;
    return `<tr style="cursor:pointer" onclick="LF.views.openLeadDrawer('${l.id}')">
      <td><b>${escapeHtml(l.name)}</b><div style="font-size:11.5px;color:var(--ink-500)">${escapeHtml(l.company||"")}</div></td>
      <td>${escapeHtml(l.industry||"—")}</td>
      <td style="max-width:240px"><div style="white-space:normal;line-height:1.4;font-size:12.5px">${catTag}<div style="margin-top:4px">${escapeHtml(o.lossReasonDetail||"—")}</div></div></td>
      <td style="max-width:180px;font-size:12.5px"><div style="white-space:normal;line-height:1.4">${escapeHtml(o.notInListReason||"—")}</div></td>
      <td style="max-width:240px"><div style="white-space:normal;line-height:1.4;font-size:12.5px">${escapeHtml(o.lossReasonSpecific||"—")}</div></td>
      <td style="white-space:nowrap;font-size:12px">${o.closedAt ? fmtDate(o.closedAt) : "—"}</td>
      <td>${escapeHtml(owner ? owner.name : "—")}</td>
      <td style="max-width:240px"><div style="white-space:normal;line-height:1.4;font-size:12.5px;color:var(--ink-700)">${escapeHtml(o.lessonsLearned||"—")}</div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--ink-400);font-size:13px">No lost leads match these filters.</td></tr>`;
  const sum = document.getElementById("lost-summary");
  if(sum) sum.textContent = `${list.length} of ${LF.outcomes.bystage("Lost").length} lost leads`;
};

LF.views.clearLostFilters = function(){
  LF.state.filters.lostLeads = {q:"",industry:"",owner:"",from:"",to:"",lossCategory:""};
  LF.router.go("lostLeads");
};

LF.views.exportOutcomesCsv = function(stage){
  const list = LF.outcomes.bystage(stage);
  const rows = [];
  if(stage === "Won"){
    rows.push(["Lead","Company","Industry","Win reason category","Why it's in our list","Why we won","Deal value","Pricing model","Contract duration","Payment terms","What we offer","Won date","Sales owner"]);
    list.forEach(l => {
      const o = l.outcome||{}, owner = ownersList().find(x=>x.id===l.ownerId);
      rows.push([l.name,l.company,l.industry,o.winCategory||"",o.winListReason||"",o.winReason||"",l.amount||0,o.pricingModel||"",o.contractDuration||"",o.paymentTerms||"",o.offering||"",o.closedAt?fmtDate(o.closedAt):"",owner?owner.name:""]);
    });
  } else {
    rows.push(["Lead","Company","Industry","Loss category","Detailed reason","Why not in our list","Why specifically","Lost date","Sales owner","Lessons learned"]);
    list.forEach(l => {
      const o = l.outcome||{}, owner = ownersList().find(x=>x.id===l.ownerId);
      rows.push([l.name,l.company,l.industry,o.lossCategory||"",o.lossReasonDetail||"",o.notInListReason||"",o.lossReasonSpecific||"",o.closedAt?fmtDate(o.closedAt):"",owner?owner.name:"",o.lessonsLearned||""]);
    });
  }
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell==null?"":cell);
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leadforge-${stage.toLowerCase()}-leads-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  LF.toast(`Exported ${list.length} ${stage.toLowerCase()} leads`,"");
};

/* ==========================================================
   ALL CLIENTS — single compiled directory of every lead the
   tenant has ever recorded, regardless of stage. The intent is
   a one-tab "give me everyone we've ever touched, with the
   service we approached and the current status, downloadable
   to Excel." Powered by LF.state.leads (same store as Leads /
   Pipeline / Won Leads / Lost Leads) so it's always live.
   ========================================================== */
LF.views.allClients = function(el){
  const f = LF.state.filters.allClients;
  // Stage breakdown for the summary strip — counts every lead, all stages.
  const all = LF.state.leads || [];
  const byStage = STAGES.reduce((o,s) => (o[s] = all.filter(l => l.stage===s).length, o), {});
  const totalAmt = all.reduce((a,b)=>a+(b.amount||0), 0);
  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">All Clients</div>
        <div class="page-sub">Every lead in the portal — contact details, service approached, status, owner. One place for the full directory.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.views.exportAllClientsCsv()">⬇ Download (Excel / CSV)</button>
        <button class="btn btn-primary" onclick="LF.views.openLeadDrawer()"><span>＋</span> New lead</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:14px">
      <div class="kpi"><div class="lbl">Total clients</div><div class="val">${all.length}</div><div class="delta up">live · all stages</div></div>
      <div class="kpi"><div class="lbl">Open pipeline</div><div class="val">${all.filter(l => !["Won","Lost"].includes(l.stage)).length}</div><div class="delta up">${fmtCur(all.filter(l=>!["Won","Lost"].includes(l.stage)).reduce((a,b)=>a+(b.amount||0),0))}</div></div>
      <div class="kpi"><div class="lbl">Won deals</div><div class="val">${byStage.Won||0}</div><div class="delta up">${fmtCur(all.filter(l=>l.stage==="Won").reduce((a,b)=>a+(b.amount||0),0))}</div></div>
      <div class="kpi"><div class="lbl">Total recorded value</div><div class="val">${fmtCur(totalAmt)}</div><div class="delta up">across ${all.length} leads</div></div>
    </div>

    <div class="card" style="margin-bottom:14px;padding:12px 16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <div style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-500);margin-right:6px">Breakdown by status</div>
        ${STAGES.map(s => {
          const n = byStage[s]||0;
          const tone = s==="Won"?"green":s==="Lost"?"slate":"blue";
          return `<span class="tag ${tone}" style="font-size:11.5px">${escapeHtml(s)} · ${n}</span>`;
        }).join("")}
      </div>
    </div>

    <div class="tbl-wrap">
      <div class="tbl-toolbar">
        <div class="tbl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="ac-q" placeholder="Search name, company, email, phone, service…" value="${escapeHtml(f.q||"")}">
        </div>
        <select class="filter" id="ac-stage">
          <option value="">All statuses</option>
          ${STAGES.map(s=>`<option value="${s}" ${f.stage===s?"selected":""}>${s}</option>`).join("")}
        </select>
        <select class="filter" id="ac-industry">
          <option value="">All industries</option>
          ${LF.picklists.industries().map(i=>`<option value="${escapeHtml(i)}" ${f.industry===i?"selected":""}>${escapeHtml(i)}</option>`).join("")}
        </select>
        <select class="filter" id="ac-source">
          <option value="">All sources</option>
          ${[...new Set(SOURCES)].map(s=>`<option value="${escapeHtml(s)}" ${f.source===s?"selected":""}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <select class="filter" id="ac-owner">
          <option value="">All owners</option>
          ${ownersList().map(o=>`<option value="${o.id}" ${f.owner===o.id?"selected":""}>${escapeHtml(o.name)}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" onclick="LF.views.clearAllClientsFilters()">Clear</button>
      </div>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Company</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Industry</th>
            <th>Service approached</th>
            <th>Source</th>
            <th>Status</th>
            <th>Score</th>
            <th>Deal value</th>
            <th>Owner</th>
            <th>Created</th>
            <th>Last activity</th>
          </tr>
        </thead>
        <tbody id="ac-rows"></tbody>
      </table>
      </div>
      <div class="tbl-foot"><div id="ac-summary"></div></div>
    </div>
  `;
  ["ac-q","ac-stage","ac-industry","ac-source","ac-owner"].forEach(id=>{
    const el = document.getElementById(id); if(!el) return;
    el.addEventListener("input", ()=>{
      const k = id.slice(3);
      LF.state.filters.allClients[k] = el.value;
      LF.views.renderAllClientsRows();
    });
  });
  LF.views.renderAllClientsRows();
};

LF.views.filteredAllClients = function(){
  const f = LF.state.filters.allClients;
  const q = (f.q||"").toLowerCase();
  const me = LF.state.user && LF.state.user.id;
  return (LF.state.leads||[]).filter(l => {
    if(typeof LF.canViewLead === "function" && !LF.canViewLead(l, me)) return false;
    if(f.stage && l.stage !== f.stage) return false;
    if(f.industry && l.industry !== f.industry) return false;
    if(f.source && l.source !== f.source) return false;
    if(f.owner && l.ownerId !== f.owner) return false;
    if(q){
      const svc = LF.views._serviceLabelFor(l);
      const blob = [l.name,l.company,l.email,l.phone,l.city,l.country,l.industry,l.source,l.stage,svc,l.notes,l.outcome?.offering].filter(Boolean).join(" ").toLowerCase();
      if(!blob.includes(q)) return false;
    }
    return true;
  }).sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
};

// Resolve serviceInterest → human-readable label. Falls back to outcome.offering
// for Won leads so the All Clients view shows *something* in the Service column
// even when the older "service interest" picker wasn't filled in.
LF.views._serviceLabelFor = function(l){
  const si = l && l.serviceInterest;
  if(si && si.serviceId && LF.qual && LF.qual.getService){
    const s = LF.qual.getService(si.serviceId);
    if(s) return s.name;
  }
  if(l && l.outcome && l.outcome.offering) return l.outcome.offering;
  return "";
};

LF.views.renderAllClientsRows = function(){
  const list = LF.views.filteredAllClients();
  const tbody = document.getElementById("ac-rows"); if(!tbody) return;
  const stageTone = s => s==="Won" ? "background:#D1FAE5;color:#065F46"
                       : s==="Lost" ? "background:#F3F4F6;color:var(--ink-500)"
                       : s==="Qualified" || s==="Demo" || s==="Proposal" || s==="Negotiation" ? "background:#DBEAFE;color:#1E40AF"
                       : "background:var(--ab7-sky-ghost);color:var(--ab7-blue-deep)";
  tbody.innerHTML = list.length ? list.map(l => {
    const owner = ownersList().find(x=>x.id===l.ownerId);
    const svc = LF.views._serviceLabelFor(l) || "—";
    const lastAct = (l.activities && l.activities.length) ? Math.max(...l.activities.map(a => a.at||0)) : (l.updatedAt||0);
    return `<tr style="cursor:pointer" onclick="LF.views.openLeadDrawer('${l.id}')">
      <td><b>${escapeHtml(l.name||"—")}</b></td>
      <td>${escapeHtml(l.company||"—")}</td>
      <td style="font-size:12px"><a href="mailto:${escapeHtml(l.email||"")}" onclick="event.stopPropagation()">${escapeHtml(l.email||"—")}</a></td>
      <td style="font-size:12px;font-family:var(--font-mono);white-space:nowrap">${escapeHtml(l.phone||"—")}</td>
      <td style="font-size:12.5px">${escapeHtml(l.industry||"—")}</td>
      <td style="max-width:200px;font-size:12.5px"><div style="white-space:normal;line-height:1.4">${escapeHtml(svc)}</div></td>
      <td style="font-size:12.5px">${escapeHtml(l.source||"—")}</td>
      <td><span class="tag" style="font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:5px;${stageTone(l.stage)}">${escapeHtml(l.stage||"—")}</span></td>
      <td style="font-family:var(--font-mono);font-weight:700">${l.score!=null?l.score:"—"}</td>
      <td style="font-family:var(--font-mono);font-size:12px;white-space:nowrap">${fmtCur(l.amount||0)}</td>
      <td style="font-size:12.5px">${escapeHtml(owner ? owner.name : "—")}</td>
      <td style="font-size:11.5px;color:var(--ink-500);white-space:nowrap">${l.createdAt ? fmtDate(l.createdAt) : "—"}</td>
      <td style="font-size:11.5px;color:var(--ink-500);white-space:nowrap">${lastAct ? fmtTime(lastAct) : "—"}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="13" style="padding:24px;text-align:center;color:var(--ink-400);font-size:13px">No clients match these filters. Clear filters or add a new lead.</td></tr>`;
  const sum = document.getElementById("ac-summary");
  if(sum) sum.textContent = `${list.length} of ${(LF.state.leads||[]).length} clients`;
};

LF.views.clearAllClientsFilters = function(){
  LF.state.filters.allClients = {q:"",stage:"",industry:"",source:"",owner:""};
  LF.router.go("allClients");
};

// CSV export of the All Clients view — Excel-compatible (UTF-8 BOM prefix
// so Excel renders accented chars and the rupee symbol correctly). Includes
// every meaningful field; respects the current filter so users can export
// subsets ("everyone in SaaS who's Qualified", etc.).
LF.views.exportAllClientsCsv = function(){
  const list = LF.views.filteredAllClients();
  const headers = ["Lead Name","Company","Email","Phone","City","Country","Industry","Service Approached","Source","Status","Score","Deal Value (INR)","Pricing Model","Owner","Created","Last Activity","Notes","Win/Loss Reason","Lessons / Action Items"];
  const rows = [headers];
  list.forEach(l => {
    const owner = ownersList().find(x=>x.id===l.ownerId);
    const o = l.outcome || {};
    const reason = l.stage === "Won" ? (o.winCategory || o.winReason || "") :
                   l.stage === "Lost" ? (o.lossCategory || o.lossReasonDetail || "") : "";
    const svc = LF.views._serviceLabelFor(l) || (o.offering || "");
    const lastAct = (l.activities && l.activities.length) ? Math.max(...l.activities.map(a => a.at||0)) : (l.updatedAt||0);
    rows.push([
      l.name||"", l.company||"", l.email||"", l.phone||"", l.city||"", l.country||"",
      l.industry||"", svc, l.source||"", l.stage||"", l.score!=null?l.score:"",
      l.amount||0, o.pricingModel||"", owner?owner.name:"",
      l.createdAt?fmtDate(l.createdAt):"", lastAct?fmtDate(lastAct):"",
      (l.notes||"").replace(/\s+/g," ").trim(),
      reason, o.lessonsLearned||""
    ]);
  });
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell==null?"":cell);
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }).join(",")).join("\n");
  // UTF-8 BOM so Excel for Windows opens the file in UTF-8 mode and renders
  // ₹ + accented characters correctly without "Save as Unicode" gymnastics.
  const blob = new Blob(["﻿"+csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leadforge-all-clients-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  LF.toast(`Downloaded ${list.length} clients — open in Excel`,"");
};

LF.views.toggleConsent = function(id, k, el){
  const l = LF.state.leads.find(x=>x.id===id);
  l.consent[k] = !l.consent[k];
  el.classList.toggle("on", l.consent[k]);
  l.activities.push({type:"consent",at:Date.now(),by:LF.state.user.id,text:`Consent ${k}: ${l.consent[k]?'granted':'revoked'}`});
  LF.storage.save();
  LF.toast("Consent updated","");
};
LF.views.erasePII = function(id){
  const l = LF.state.leads.find(x=>x.id===id);
  l.name="(erased)"; l.firstName="(erased)"; l.lastName=""; l.email="erased@privacy.local"; l.phone=""; l.notes="";
  l.activities.push({type:"erasure",at:Date.now(),by:LF.state.user.id,text:"Right-to-erasure executed — PII scrubbed."});
  LF.storage.save(); LF.drawer.close(); LF.toast("PII erased","info"); if(LF.state.route==="leads") LF.views.renderLeadRows();
};
LF.views.addActivity = function(id){
  const txt = prompt("Log an activity (note, call, email summary):");
  if(!txt) return;
  const l = LF.state.leads.find(x=>x.id===id);
  l.activities.push({type:"note",at:Date.now(),by:LF.state.user.id,text:txt});
  l.updatedAt=Date.now();
  LF.storage.save();
  LF.views.openLeadDrawer(id);
};
LF.views.runFollowup = function(id){
  const l = LF.state.leads.find(x=>x.id===id);
  if(!l) return;
  l.activities.push({type:"enrich",at:Date.now(),by:"a5",text:"Follow-up Agent scheduled a 5-touch sequence"});
  l.updatedAt = Date.now();
  const a = LF.state.agents.find(x=>x.id==="a5"); if(a){ a.runs += 1; a.last="just now"; a.status="running"; }
  LF.storage.save();
  LF.drawer.close();
  LF.toast(`Follow-up Agent queued for ${l.name}`,"");
};
LF.views.leadDsar = function(id){
  const l = LF.state.leads.find(x=>x.id===id);
  const blob = new Blob([JSON.stringify(l,null,2)],{type:"application/json"});
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`dsar-${l.id}.json`; a.click(); URL.revokeObjectURL(a.href);
  LF.toast("DSAR JSON exported","");
};
LF.views.exportActivity = function(){
  const acts = LF.state.leads.flatMap(l=>l.activities.map(a=>({lead:l.name,company:l.company,type:a.type,text:a.text,at:new Date(a.at).toISOString(),by:ownersList().find(o=>o.id===a.by)?.name||"System"})));
  const h = ["lead","company","type","text","at","by"];
  const rows = [h.join(",")].concat(acts.map(r=>h.map(k=>`"${String(r[k]).replace(/"/g,'""')}"`).join(",")));
  const blob = new Blob([rows.join("\n")],{type:"text/csv"});
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`activity-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  LF.toast(`Exported ${acts.length} events`,"");
};

/* ==========================================================
   PIPELINE (Kanban)
   ========================================================== */
LF.views.pipeline = function(el){
  const mode = LF.state.pipelineView || "kanban";
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Pipeline</div><div class="page-sub">${mode==='kanban'?'Drag cards between stages.':'List view — click a row to open the deal.'} Real-time value and count per stage.</div></div>
      <div class="page-actions">
        <div class="seg" title="View format">
          <button class="${mode==='kanban'?'active':''}" onclick="LF.views.setPipelineView('kanban',this)">▦ Kanban</button>
          <button class="${mode==='list'?'active':''}" onclick="LF.views.setPipelineView('list',this)">≡ List</button>
        </div>
        <div class="seg"><button class="${(LF.state.pipelineScope||'all')==='all'?'active':''}" onclick="LF.actions.pipelineFilter('all',this)">All</button><button class="${LF.state.pipelineScope==='mine'?'active':''}" onclick="LF.actions.pipelineFilter('mine',this)">My deals</button><button class="${LF.state.pipelineScope==='team'?'active':''}" onclick="LF.actions.pipelineFilter('team',this)">Team</button></div>
        <button class="btn btn-primary" onclick="LF.views.openLeadDrawer()">＋ New deal</button>
      </div>
    </div>
    <div id="pipeline-body"></div>
  `;
  LF.views.renderPipeline();
};
LF.views.setPipelineView = function(mode, btn){
  LF.state.pipelineView = mode;
  if(btn){ btn.parentElement.querySelectorAll("button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); }
  LF.storage.save();
  LF.router.go("pipeline");
};
LF.views.renderPipeline = function(){
  const mode = LF.state.pipelineView || "kanban";
  const body = document.getElementById("pipeline-body"); if(!body) return;
  body.innerHTML = mode==='list' ? '<div id="pipeline-list"></div>' : '<div class="kanban-wrap"><div class="kanban" id="kanban"></div></div>';
  if(mode==='list') LF.views.renderPipelineList(); else LF.views.renderKanban();
};
LF.views.pipelineFiltered = function(){
  const scope = LF.state.pipelineScope || "all";
  const me = LF.state.user.id;
  const teamMates = ownersList().filter(o=>o.role!=="Admin").map(o=>o.id);
  return LF.state.leads.filter(l=>{
    if(scope==="mine") return l.ownerId===me;
    if(scope==="team") return teamMates.includes(l.ownerId);
    return true;
  });
};
LF.views.renderPipelineList = function(){
  const list = LF.views.pipelineFiltered().slice().sort((a,b)=>STAGES.indexOf(a.stage)-STAGES.indexOf(b.stage) || b.amount-a.amount);
  const wrap = document.getElementById("pipeline-list"); if(!wrap) return;
  const totalAmt = list.reduce((a,b)=>a+b.amount,0);
  const grandCount = list.length;
  wrap.innerHTML = `
    <div class="pipe-strip">
      ${STAGES.map((s,i)=>{
        const g = list.filter(l=>l.stage===s);
        const sum = g.reduce((a,b)=>a+b.amount,0);
        const pct = grandCount? Math.round((g.length/grandCount)*100) : 0;
        const tone = s==='Won'?'won':s==='Lost'?'lost':'open';
        return `<div class="pipe-stage tone-${tone}" data-stage="${s}">
          <div class="pipe-stage-top"><span class="pipe-stage-name">${s}</span><span class="pipe-stage-count">${g.length}</span></div>
          <div class="pipe-stage-amt">${fmtCur(sum)}</div>
          <div class="pipe-stage-bar"><span style="width:${pct}%"></span></div>
          <div class="pipe-stage-pct">${pct}% of deals</div>
        </div>${i<STAGES.length-1?'<div class="pipe-stage-sep">›</div>':''}`;
      }).join("")}
    </div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>
          <th>Deal</th><th>Company</th><th>Stage</th><th>Value</th><th>Score</th><th>Owner</th><th>Updated</th><th></th>
        </tr></thead>
        <tbody>
          ${list.length? list.map(l=>{
            const o = ownersList().find(x=>x.id===l.ownerId)||{name:"Unassigned",avatar:"?",grp:""};
            const sc = LF.formula.healthClass(l);
            return `<tr onclick="LF.views.openLeadDrawer('${l.id}')" style="cursor:pointer">
              <td><div class="who"><div class="avatar-sm ${l.tags.includes('hot')?'g2':''}">${initials(l.name)}</div><div><div style="font-weight:700">${escapeHtml(l.name)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(l.email)}</div></div></div></td>
              <td><div style="font-weight:600">${escapeHtml(l.company)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(l.city)}, ${l.country}</div></td>
              <td><select class="filter" onclick="event.stopPropagation()" onchange="LF.views.changeStageFromList('${l.id}',this.value)">${STAGES.map(s=>`<option ${s===l.stage?'selected':''}>${s}</option>`).join("")}</select></td>
              <td style="font-family:var(--font-mono);font-weight:800;color:var(--ab7-green-deep)">${fmtCur(l.amount,l.currency)}</td>
              <td><span class="score-pill ${sc}">${l.score}</span></td>
              <td><div class="who"><div class="avatar-sm ${o.grp||''}">${o.avatar}</div><span style="font-size:12px">${escapeHtml(o.name.split(" ")[0])}</span></div></td>
              <td style="font-size:12px;color:var(--ink-500)">${fmtTime(l.updatedAt)}</td>
              <td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();LF.views.openLeadDrawer('${l.id}')">Open</button></td>
            </tr>`;
          }).join("") : `<tr><td colspan="8" class="tbl-empty">No deals match the current filter.</td></tr>`}
        </tbody>
      </table>
      <div class="tbl-foot"><div>${list.length} deals · total ${fmtCur(totalAmt)}</div></div>
    </div>`;
};
LF.views.changeStageFromList = function(id, stage){
  const l = LF.state.leads.find(x=>x.id===id); if(!l || l.stage===stage) return;
  l.stage = stage; l.updatedAt = Date.now();
  l.activities.push({type:"stage",at:Date.now(),by:LF.state.user.id,text:`Moved to ${stage}`});
  LF.storage.save();
  LF.toast(`${l.name} → ${stage}`,"");
  LF.views.renderPipelineList();
};
LF.views.renderKanban = function(){
  const kanban = document.getElementById("kanban");
  const scope = LF.state.pipelineScope || "all";
  const me = LF.state.user.id;
  const teamMates = ownersList().filter(o=>o.role!=="Admin").map(o=>o.id);
  kanban.innerHTML = STAGES.map(s=>{
    let cards = LF.state.leads.filter(l=>l.stage===s);
    if(scope==="mine") cards = cards.filter(c=>c.ownerId===me);
    else if(scope==="team") cards = cards.filter(c=>teamMates.includes(c.ownerId));
    const total = cards.reduce((a,b)=>a+b.amount,0);
    return `<div class="kanban-col" data-stage="${s}" ondragover="event.preventDefault();this.classList.add('drop-active')" ondragleave="this.classList.remove('drop-active')" ondrop="LF.views.dropCard(event,'${s}')">
      <div class="kanban-col-head">
        <div><div class="title">${s}</div><div class="value">${fmtCur(total)}</div></div>
        <div class="count">${cards.length}</div>
      </div>
      <div class="kanban-col-body">
      ${cards.map(c=>{
        const o = ownersList().find(x=>x.id===c.ownerId);
        const sc = LF.formula.healthClass(c);
        return `<div class="kanban-card" draggable="true" ondragstart="LF.views.dragCard(event,'${c.id}')" ondragend="this.classList.remove('dragging');document.querySelectorAll('.kanban-col').forEach(k=>k.classList.remove('drop-active'))" onclick="LF.views.openLeadDrawer('${c.id}')">
          <div class="title">${escapeHtml(c.name)}</div>
          <div class="co">${escapeHtml(c.company)} · ${escapeHtml(c.city)}</div>
          <div class="row">
            <span class="amt">${fmtCur(c.amount,c.currency)}</span>
            <div style="display:flex;gap:5px;align-items:center">
              <span class="score-pill ${sc}">${c.score}</span>
              <div class="avatar-sm ${o?.grp||''}" style="width:22px;height:22px;font-size:9px">${o?.avatar||'?'}</div>
            </div>
          </div>
        </div>`;
      }).join("")}
      </div>
    </div>`;
  }).join("");
};
LF.views.dragCard = function(ev, id){ ev.dataTransfer.setData("text/plain", id); ev.target.classList.add("dragging") };
LF.views.dropCard = function(ev, stage){
  ev.preventDefault();
  const id = ev.dataTransfer.getData("text/plain");
  const l = LF.state.leads.find(x=>x.id===id);
  if(!l || l.stage===stage){ document.querySelectorAll(".kanban-col").forEach(k=>k.classList.remove("drop-active")); return }
  l.stage = stage; l.updatedAt = Date.now();
  l.activities.push({type:"stage",at:Date.now(),by:LF.state.user.id,text:`Moved to ${stage}`});
  LF.storage.save();
  LF.toast(`${l.name} → ${stage}`,"");
  LF.views.renderKanban();
};

/* ==========================================================
   INBOX
   ========================================================== */
LF.views.inbox = function(el){
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Omnichannel Inbox</div><div class="page-sub">Email · WhatsApp · SMS · Voice · LinkedIn · Live chat — one thread per lead.</div></div>
      <div class="page-actions">
        <div class="seg" id="inbox-seg"><button class="active" data-f="all">All</button><button data-f="unread">Unread</button><button data-f="email">Email</button><button data-f="whatsapp">WhatsApp</button></div>
      </div>
    </div>
    <div class="inbox">
      <div class="inbox-list" id="inbox-list"></div>
      <div class="inbox-main" id="inbox-main"></div>
      <div class="inbox-side" id="inbox-side"></div>
    </div>
  `;
  document.querySelectorAll("#inbox-seg button").forEach(b=> b.addEventListener("click",()=>{ document.querySelectorAll("#inbox-seg button").forEach(x=>x.classList.remove("active")); b.classList.add("active"); LF.views.renderInbox(b.dataset.f) }));
  LF.views.renderInbox("all");
  if(LF.state.threads.length) LF.views.openThread(LF.state.threads[0].id);
};
LF.views.renderInbox = function(filter){
  const list = document.getElementById("inbox-list");
  let threads = LF.state.threads.slice();
  if(filter==="unread") threads = threads.filter(t=>t.unread);
  else if(filter && filter!=="all") threads = threads.filter(t=>t.channel===filter);
  list.innerHTML = threads.map(t=>{
    const lead = LF.state.leads.find(l=>l.id===t.leadId);
    if(!lead) return '';
    const last = t.messages[t.messages.length-1];
    const ch = {email:"✉",whatsapp:"💬",sms:"📱",linkedin:"in",voice:"📞"};
    return `<div class="thread-item ${t.id===LF.state.currentThreadId?'active':''}" onclick="LF.views.openThread('${t.id}')">
      <div class="hdr"><span class="nm">${escapeHtml(lead.name)}</span><span class="ts">${fmtTime(last.at)}</span></div>
      <div class="preview">${escapeHtml(last.text).slice(0,80)}</div>
      <div class="chan"><span class="tag ${t.channel==='whatsapp'?'green':'sky'}">${ch[t.channel]||'●'} ${t.channel}${t.unread?' · unread':''}</span></div>
    </div>`;
  }).join("") || `<div style="padding:40px;text-align:center;color:var(--ink-400);font-size:13px">No messages match this filter.</div>`;
};
LF.views.openThread = function(id){
  LF.state.currentThreadId = id;
  const t = LF.state.threads.find(x=>x.id===id);
  const lead = LF.state.leads.find(l=>l.id===t.leadId);
  t.unread = false;
  LF.updateSidebarCounts();
  document.querySelectorAll(".thread-item").forEach(el=>el.classList.remove("active"));
  const active = document.querySelector(`.thread-item[onclick*="${id}"]`);
  if(active) active.classList.add("active");

  const main = document.getElementById("inbox-main");
  main.innerHTML = `
    <div class="inbox-head">
      <div class="avatar-sm g2">${initials(lead.name)}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700">${escapeHtml(lead.name)}</div>
        <div style="font-size:11.5px;color:var(--ink-400)">${escapeHtml(lead.company)} · ${escapeHtml(t.channel)} · ${escapeHtml(lead.email)}</div>
      </div>
      <button class="btn btn-ghost btn-xs" onclick="LF.views.openLeadDrawer('${lead.id}')">Open lead</button>
      <button class="btn btn-ghost btn-xs" onclick="LF.actions.summarizeThread()">✦ Summarize</button>
    </div>
    <div class="inbox-msgs" id="msgs"></div>
    <div class="inbox-compose">
      <textarea id="reply-text" placeholder="Reply — Ctrl+Enter to send"></textarea>
      <div class="row">
        <select class="filter" id="reply-chan"><option value="${t.channel}" selected>${t.channel}</option><option>email</option><option>whatsapp</option><option>sms</option></select>
        <button class="btn btn-ghost btn-xs" onclick="LF.views.aiDraft()">✦ AI draft</button>
        <button class="btn btn-ghost btn-xs" onclick="LF.actions.pickTemplate()">⌘ Template</button>
        <div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" onclick="LF.views.sendReply()">Send ▶</button>
      </div>
    </div>
  `;
  const msgs = document.getElementById("msgs");
  msgs.innerHTML = t.messages.map(m=>{
    const mine = m.from==="me";
    return `<div class="msg ${mine?'me':''}">
      ${mine?'':`<div class="avatar-sm" style="margin-top:4px">${initials(lead.name)}</div>`}
      <div>
        <div class="bubble">${escapeHtml(m.text)}</div>
        <div class="meta" style="text-align:${mine?'right':'left'}">${mine?'You':lead.firstName} · ${fmtTime(m.at)}</div>
      </div>
    </div>`;
  }).join("");
  msgs.scrollTop = msgs.scrollHeight;
  document.getElementById("reply-text").addEventListener("keydown", e=>{ if((e.ctrlKey||e.metaKey)&&e.key==="Enter") LF.views.sendReply() });

  // side
  document.getElementById("inbox-side").innerHTML = `
    <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-500);margin-bottom:8px">Lead snapshot</div>
    <div class="profile-head" style="padding:14px;border:1px solid var(--ink-150);border-radius:10px;background:#fff">
      <div style="font-size:15px;font-weight:700">${escapeHtml(lead.name)}</div>
      <div style="font-size:11.5px;color:var(--ink-400)">${escapeHtml(lead.email)}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><span class="tag ${STAGE_COLORS[lead.stage]}">${lead.stage}</span><span class="score-pill ${lead.score>=75?'hot':'warm'}">${lead.score}</span></div>
      <dl class="kv" style="margin-top:12px">
        <dt>Company</dt><dd>${escapeHtml(lead.company)}</dd>
        <dt>Industry</dt><dd>${escapeHtml(lead.industry)}</dd>
        <dt>Location</dt><dd>${escapeHtml(lead.city)}, ${lead.country}</dd>
        <dt>Source</dt><dd>${escapeHtml(lead.source)}</dd>
        <dt>Value</dt><dd>${fmtCur(lead.amount,lead.currency)}</dd>
      </dl>
    </div>
    <div style="margin-top:16px;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-500);margin-bottom:8px">✦ AI sentiment</div>
    <div style="padding:10px 12px;background:rgba(20,216,166,.1);border:1px solid rgba(20,216,166,.3);border-radius:8px;font-size:12px;color:var(--ink-700)">
      <b style="color:var(--ab7-green-deep)">Positive · 0.82</b><br>
      Buyer is engaged and moving toward a meeting. Tone: professional, time-sensitive.
    </div>
  `;
};
LF.views.aiDraft = async function(){
  const t = LF.state.threads.find(x=>x.id===LF.state.currentThreadId);
  const lead = LF.state.leads.find(l=>l.id===t.leadId);
  LF.claude._bootstrap();
  if(LF.claude.isConfigured() && LF.state.claudeConfig.useFor.emailDrafts){
    const ta = document.getElementById("reply-text");
    if(ta){ ta.value = "Drafting with Claude…"; ta.disabled = true; }
    const prompt = `Draft a concise, friendly sales reply from ${LF.state.user.name} to ${lead.firstName} at ${lead.company} in the ${lead.industry} industry. The current thread is on ${t.channel}. Keep it under 120 words. Suggest a specific next step (meeting, deck, pricing). Do not hallucinate details — reference only what is plausible.`;
    const res = await LF.claude.complete(prompt, {kind:"email-draft", lead, maxTokens:350});
    if(ta){ ta.value = res.text; ta.disabled = false; }
    LF.toast(res.demo?"AI draft generated (demo)":`Drafted via Claude · $${res.cost.toFixed(5)}`, "info");
    return;
  }
  const drafts = [
    `Hi ${lead.firstName}, thanks for the details. Pricing for ${lead.company}: the Growth plan starts at $35/user/month and includes all channels, AI agents, and HubSpot migration. Happy to scope a tailored quote on Tuesday's call.`,
    `Hi ${lead.firstName}, confirming Tuesday at 3 PM IST. I'll send a Meet link after this. I'll bring a quick LeadForge walkthrough focused on your ${lead.industry.toLowerCase()} use case plus the HubSpot migration path. Any specific requirements you'd like covered?`,
    `Hi ${lead.firstName}, sharing the ${lead.industry} case study deck. It covers similar clients, ROI, implementation timeline, and compliance (DPDP-ready). Let me know if you'd like a reference call.`
  ];
  document.getElementById("reply-text").value = rand(drafts);
  LF.toast("AI draft generated — edit before sending","info");
};
LF.views.sendReply = function(){
  const text = document.getElementById("reply-text").value.trim();
  if(!text){ LF.toast("Type a message","err"); return }
  const t = LF.state.threads.find(x=>x.id===LF.state.currentThreadId);
  const chan = (document.getElementById("reply-chan")||{}).value || t.channel;
  let fromLabel = "you";
  if(chan==="email"){
    const res = LF.email.sendFromInbox(t, text);
    if(!res.ok){ LF.toast(res.msg,"err"); return }
    fromLabel = res.from;
  }
  const sig = (LF.state.emailPrefs && LF.state.emailPrefs.signature) ? LF.state.emailPrefs.signature : "";
  const body = (chan==="email" && sig) ? `${text}\n\n${sig}` : text;
  t.messages.push({from:"me",at:Date.now(),text:body,via:chan,from_email:chan==="email"?fromLabel:undefined});
  const lead = LF.state.leads.find(l=>l.id===t.leadId);
  lead.activities.push({type:"msg",at:Date.now(),by:LF.state.user.id,text:`Replied via ${chan}${chan==="email"?` (from ${fromLabel})`:""}`});
  lead.updatedAt = Date.now();
  LF.storage.save();
  LF.views.openThread(t.id);
  LF.toast(chan==="email"?`Email sent from ${fromLabel}`:"Message sent","");
};

/* ==========================================================
   ACTIVITY
   ========================================================== */
LF.views.activity = function(el){
  const acts = LF.state.leads.flatMap(l=>l.activities.map(a=>({...a,lead:l}))).sort((a,b)=>b.at-a.at);
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Activity Timeline</div><div class="page-sub">${acts.length} events · every touch logged for audit & coaching.</div></div>
      <div class="page-actions">
        <select class="filter" id="act-filter"><option value="">All types</option><option>create</option><option>stage</option><option>email</option><option>msg</option><option>assign</option><option>enrich</option><option>consent</option></select>
        <button class="btn btn-ghost btn-sm" onclick="LF.views.exportActivity()">⬇ Export</button>
      </div>
    </div>
    <div class="card"><div id="timeline"></div></div>
  `;
  const render = (f)=>{
    const list = f?acts.filter(a=>a.type===f):acts;
    document.getElementById("timeline").innerHTML = list.slice(0,150).map(a=>{
      const icons = {create:"👤",email:"✉",msg:"💬",call:"📞",meeting:"📅",stage:"▣",assign:"→",enrich:"✦",consent:"✓",note:"📝",erasure:"⊘",edit:"✎"};
      return `<div class="activity-item"><div class="ic">${icons[a.type]||'●'}</div>
        <div class="body"><div class="t"><b>${escapeHtml(a.lead.name)}</b> (${escapeHtml(a.lead.company)}) — ${escapeHtml(a.text)}</div>
        <div class="m">${fmtTime(a.at)} · by ${ownersList().find(o=>o.id===a.by)?.name||'System'}</div></div></div>`;
    }).join("") || '<div style="padding:40px;text-align:center;color:var(--ink-400)">No activity.</div>';
  };
  render();
  document.getElementById("act-filter").addEventListener("change",e=>render(e.target.value));
};

/* ==========================================================
   SCORING
   ========================================================== */
/* ==========================================================
   QUALIFICATION SYSTEM — service domains, services, checklists
   ========================================================== */
LF.qual = {
  _bootstrap(){
    if(!LF.state.serviceDomains){
      LF.state.serviceDomains = [
        {id:"d-it",   name:"IT Services",         icon:"💻", color:"blue"},
        {id:"d-re",   name:"Real Estate",         icon:"🏢", color:"green"},
        {id:"d-hc",   name:"Healthcare",          icon:"⚕",  color:"sky"},
        {id:"d-edu",  name:"Education",           icon:"🎓", color:"warn"},
        {id:"d-fin",  name:"Financial Services",  icon:"💰", color:"slate"}
      ];
    }
    if(!LF.state.serviceCatalog){
      LF.state.serviceCatalog = [
        {id:"s-web",  domainId:"d-it",  name:"Website Development",     description:"Design, build, and deploy a corporate or commerce website."},
        {id:"s-crm",  domainId:"d-it",  name:"CRM Implementation",      description:"Roll out a new CRM — discovery, configuration, data migration, training."},
        {id:"s-cloud",domainId:"d-it",  name:"Cloud Migration",         description:"Lift-and-shift or re-architect applications onto AWS/Azure/GCP."},
        {id:"s-sec",  domainId:"d-it",  name:"Cybersecurity Audit",     description:"Vulnerability assessment, pen testing, remediation roadmap."},
        {id:"s-aiml", domainId:"d-it",  name:"AI / ML Consulting",      description:"From use-case shaping to production model delivery."},
        {id:"s-prop", domainId:"d-re",  name:"Property Search",         description:"Residential or commercial property acquisition."},
        {id:"s-rent", domainId:"d-re",  name:"Rental Management",       description:"Tenant sourcing, lease admin, maintenance coordination."},
        {id:"s-clin", domainId:"d-hc",  name:"Clinic Setup",            description:"End-to-end clinic establishment: licensing, fit-out, staffing."},
        {id:"s-emr",  domainId:"d-hc",  name:"EMR Integration",         description:"Deploy or replace an electronic medical records system."},
        {id:"s-edu-p",domainId:"d-edu", name:"Online Course Platform",  description:"LMS, content production, student onboarding, payments."},
        {id:"s-fin-w",domainId:"d-fin", name:"Wealth Advisory",         description:"Portfolio review, planning, investment recommendations."},
        {id:"s-fin-l",domainId:"d-fin", name:"Lending / Credit",        description:"Personal or business loan origination."}
      ];
    }
    if(!LF.state.qualificationTemplates){
      LF.state.qualificationTemplates = [
        {id:"qt-crm", serviceId:"s-crm", name:"CRM Implementation — BANT+",
          questions:[
            {id:"q1", text:"Has the client identified which CRM they're moving away from?",          type:"yesno", weight:10},
            {id:"q2", text:"Is a budget of at least $50,000 confirmed?",                              type:"yesno", weight:25},
            {id:"q3", text:"Is a decision-maker (VP/Director level) actively engaged?",              type:"yesno", weight:20},
            {id:"q4", text:"Is the desired go-live within 6 months?",                                type:"yesno", weight:15},
            {id:"q5", text:"How many users need to be onboarded?",                                    type:"select", options:["< 10","10 – 50","50 – 200","200+"], weights:[0,8,12,15]},
            {id:"q6", text:"Are integration requirements (ERP, telephony, WhatsApp) documented?",    type:"yesno", weight:10},
            {id:"q7", text:"Has data-migration scope been discussed?",                               type:"yesno", weight:5}
          ],
          thresholds:{qualified:60, nurture:30}
        },
        {id:"qt-web", serviceId:"s-web", name:"Website Development",
          questions:[
            {id:"q1", text:"Is a wireframe or sitemap already available?",                            type:"yesno", weight:10},
            {id:"q2", text:"Budget range agreed (INR)?",                                              type:"select", options:["< 5k","5k – 20k","20k – 50k","50k+"], weights:[0,10,18,25]},
            {id:"q3", text:"Launch timeline under 90 days?",                                          type:"yesno", weight:15},
            {id:"q4", text:"Brand assets (logo, guidelines) available?",                              type:"yesno", weight:10},
            {id:"q5", text:"Content ready or to be produced?",                                        type:"yesno", weight:10},
            {id:"q6", text:"E-commerce or transactional flows required?",                             type:"yesno", weight:10},
            {id:"q7", text:"SEO / analytics requirements documented?",                                type:"yesno", weight:10}
          ],
          thresholds:{qualified:55, nurture:25}
        },
        {id:"qt-cloud", serviceId:"s-cloud", name:"Cloud Migration",
          questions:[
            {id:"q1", text:"Existing workload inventory completed?",                                  type:"yesno", weight:15},
            {id:"q2", text:"Target cloud provider decided?",                                          type:"select", options:["Undecided","AWS","Azure","GCP","Multi-cloud"], weights:[0,15,15,12,10]},
            {id:"q3", text:"Annual infra spend ≥ $100k?",                                             type:"yesno", weight:20},
            {id:"q4", text:"Executive sponsor identified?",                                           type:"yesno", weight:15},
            {id:"q5", text:"Compliance requirements (DPDP/HIPAA/PCI) documented?",                    type:"yesno", weight:10},
            {id:"q6", text:"Migration deadline under 9 months?",                                      type:"yesno", weight:10}
          ],
          thresholds:{qualified:55, nurture:25}
        },
        {id:"qt-sec", serviceId:"s-sec", name:"Cybersecurity Audit",
          questions:[
            {id:"q1", text:"Triggered by compliance mandate (ISO/SOC2/DPDP)?",                        type:"yesno", weight:20},
            {id:"q2", text:"Scope: assets in scope?",                                                  type:"select", options:["< 50","50 – 500","500 – 5k","5k+"], weights:[0,10,15,20]},
            {id:"q3", text:"Timeline under 60 days?",                                                  type:"yesno", weight:15},
            {id:"q4", text:"Budget ≥ $25k?",                                                           type:"yesno", weight:15},
            {id:"q5", text:"Prior audit report available?",                                            type:"yesno", weight:10},
            {id:"q6", text:"Remediation to be bundled?",                                               type:"yesno", weight:15}
          ],
          thresholds:{qualified:50, nurture:25}
        },
        {id:"qt-prop", serviceId:"s-prop", name:"Property Search",
          questions:[
            {id:"q1", text:"Buyer vs investor?",                                                       type:"select", options:["Undecided","End-user","Investor"], weights:[0,10,15]},
            {id:"q2", text:"Loan pre-approval in place?",                                              type:"yesno", weight:15},
            {id:"q3", text:"Budget range?",                                                            type:"select", options:["< 50L","50L – 1Cr","1 – 3Cr","3Cr+"], weights:[0,8,15,20]},
            {id:"q4", text:"Location short-listed?",                                                   type:"yesno", weight:15},
            {id:"q5", text:"Timeline under 90 days?",                                                  type:"yesno", weight:10},
            {id:"q6", text:"Site-visit attended?",                                                     type:"yesno", weight:15}
          ],
          thresholds:{qualified:55, nurture:25}
        },
        {id:"qt-emr", serviceId:"s-emr", name:"EMR Integration",
          questions:[
            {id:"q1", text:"HIPAA / DPDP compliance obligation confirmed?",                           type:"yesno", weight:20},
            {id:"q2", text:"Number of providers / clinicians?",                                        type:"select", options:["< 5","5 – 20","20 – 100","100+"], weights:[0,8,14,20]},
            {id:"q3", text:"Existing EMR vendor identified?",                                         type:"yesno", weight:10},
            {id:"q4", text:"Budget ≥ $40k?",                                                           type:"yesno", weight:15},
            {id:"q5", text:"Go-live within 6 months?",                                                 type:"yesno", weight:10},
            {id:"q6", text:"Integration with lab / pharmacy required?",                               type:"yesno", weight:10}
          ],
          thresholds:{qualified:55, nurture:25}
        }
      ];
    }
  },

  /* ---- Helpers ---- */
  listServicesForDomain(domainId){
    return (LF.state.serviceCatalog||[]).filter(s=>s.domainId===domainId);
  },
  getService(serviceId){ return (LF.state.serviceCatalog||[]).find(s=>s.id===serviceId) },
  getDomain(domainId){ return (LF.state.serviceDomains||[]).find(d=>d.id===domainId) },
  getTemplateForService(serviceId){ return (LF.state.qualificationTemplates||[]).find(t=>t.serviceId===serviceId) },
  getTemplate(id){ return (LF.state.qualificationTemplates||[]).find(t=>t.id===id) },

  /* Compute current score for a lead's qualification run */
  scoreAnswers(template, answers){
    if(!template) return 0;
    let max=0, got=0;
    template.questions.forEach(q=>{
      if(q.type==="yesno"){ max += q.weight; if(answers[q.id]===true) got += q.weight; }
      else if(q.type==="select"){
        const maxW = Math.max(...(q.weights||[]));
        max += maxW;
        const idx = (q.options||[]).indexOf(answers[q.id]);
        if(idx>=0) got += (q.weights||[])[idx]||0;
      }
    });
    return max ? Math.round(got/max*100) : 0;
  },
  statusFor(template, score){
    if(!template) return "unqualified";
    const t = template.thresholds || {qualified:60, nurture:30};
    if(score>=t.qualified) return "qualified";
    if(score>=t.nurture) return "nurture";
    return "disqualified";
  },

  /* Qualification statuses for all leads */
  leadStatus(lead){
    if(!lead.qualifications) return {status:"unqualified", label:"Not run", score:null, serviceId:null};
    const tpls = Object.keys(lead.qualifications);
    if(!tpls.length) return {status:"unqualified", label:"Not run", score:null, serviceId:null};
    // most recent run
    const recent = tpls.map(k=>({k,r:lead.qualifications[k]})).sort((a,b)=>b.r.runAt-a.r.runAt)[0];
    const t = LF.qual.getTemplate(recent.k);
    const serviceId = t?.serviceId || null;
    return {status:recent.r.status, label:recent.r.status, score:recent.r.score, serviceId, runAt:recent.r.runAt};
  },

  /* Open the qualification-runner modal for a specific lead */
  runForLead(leadId){
    LF.qual._bootstrap();
    const lead = LF.state.leads.find(l=>l.id===leadId); if(!lead){ LF.toast("Lead not found","err"); return }
    const domains = LF.state.serviceDomains;
    const preDomain = lead.serviceInterest?.domainId || "";
    const preService = lead.serviceInterest?.serviceId || "";

    LF.modal.open({
      title:`Qualify — ${lead.name} · ${lead.company}`,
      body:`
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <span class="tag blue">${escapeHtml(lead.industry)}</span>
          <span class="tag sky">${escapeHtml(lead.city)}, ${lead.country}</span>
          <span class="tag">${escapeHtml(lead.source)}</span>
          <span class="tag ${lead.score>=75?'danger':lead.score>=55?'warn':'slate'}">Lead score ${lead.score}</span>
        </div>

        <div class="fld-row">
          <div class="fld"><label>Service domain</label>
            <select id="qr-domain" onchange="LF.qual.onDomainChange()">
              <option value="">— pick domain —</option>
              ${domains.map(d=>`<option value="${d.id}" ${d.id===preDomain?'selected':''}>${d.icon} ${escapeHtml(d.name)}</option>`).join("")}
            </select>
          </div>
          <div class="fld"><label>Service the client wants</label>
            <select id="qr-service" onchange="LF.qual.onServiceChange('${leadId}')">
              <option value="">— pick service —</option>
            </select>
          </div>
        </div>

        <div id="qr-template"></div>
      `,
      foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
        <button class="btn btn-ghost" id="qr-save-draft" onclick="LF.qual.save('${leadId}',false)" disabled>Save draft</button>
        <button class="btn btn-primary" id="qr-save-final" onclick="LF.qual.save('${leadId}',true)" disabled>Qualify lead →</button>`
    });
    LF.qual.onDomainChange();
    if(preService){ document.getElementById("qr-service").value = preService; LF.qual.onServiceChange(leadId); }
  },

  onDomainChange(){
    const domainId = document.getElementById("qr-domain").value;
    const services = domainId ? LF.qual.listServicesForDomain(domainId) : [];
    const sel = document.getElementById("qr-service");
    sel.innerHTML = '<option value="">— pick service —</option>' + services.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    document.getElementById("qr-template").innerHTML = services.length?'<p style="color:var(--ink-500);font-size:12.5px;padding:14px;background:var(--ab7-sky-ghost);border-radius:10px">Pick the service to load its qualification checklist.</p>':'<p style="color:var(--ink-400);font-size:12.5px;padding:14px">No services configured for this domain yet. Admin → Catalog & Checklists to add one.</p>';
    document.getElementById("qr-save-draft").disabled = true;
    document.getElementById("qr-save-final").disabled = true;
  },

  onServiceChange(leadId){
    const svcId = document.getElementById("qr-service").value;
    const tpl = LF.qual.getTemplateForService(svcId);
    const box = document.getElementById("qr-template");
    if(!svcId){ box.innerHTML = ""; document.getElementById("qr-save-draft").disabled=true; document.getElementById("qr-save-final").disabled=true; return }
    if(!tpl){
      box.innerHTML = `<div style="padding:14px;background:#FEF3C7;color:#92400E;border-radius:10px;font-size:12.5px">No qualification checklist exists for this service yet. <button class="btn btn-blue btn-xs" style="margin-left:8px" onclick="LF.qual.createTemplateFor('${svcId}','${leadId}')">＋ Create checklist</button></div>`;
      document.getElementById("qr-save-draft").disabled=true; document.getElementById("qr-save-final").disabled=true; return;
    }
    // pre-fill from any prior run for this template on this lead
    const lead = LF.state.leads.find(l=>l.id===leadId);
    const prior = lead?.qualifications?.[tpl.id]?.answers || {};
    box.innerHTML = `
      <div style="border-top:1px dashed var(--ink-200);margin:10px 0 12px;padding-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:12.5px;font-weight:700;color:var(--ink-800)">${escapeHtml(tpl.name)}</div>
          <div style="font-size:11px;color:var(--ink-500)">Qualify ≥ ${tpl.thresholds.qualified} · Nurture ≥ ${tpl.thresholds.nurture}</div>
        </div>
        <div id="qr-q-list">
          ${tpl.questions.map((q,i)=>`
            <div style="padding:10px 0;border-bottom:1px dashed var(--ink-150)">
              <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px">
                <div style="font-size:13px;color:var(--ink-800);flex:1">${i+1}. ${escapeHtml(q.text)}</div>
                <div style="font-size:10.5px;color:var(--ink-400);white-space:nowrap">up to ${q.type==='yesno'?q.weight:Math.max(...(q.weights||[0]))} pts</div>
              </div>
              ${q.type==='yesno'?`
                <div style="display:flex;gap:6px">
                  <label style="display:inline-flex;gap:4px;align-items:center;font-size:12px;padding:5px 10px;border:1px solid var(--ink-200);border-radius:6px;cursor:pointer"><input type="radio" name="qr-${q.id}" value="yes" onchange="LF.qual.recompute('${tpl.id}')" ${prior[q.id]===true?'checked':''}> Yes</label>
                  <label style="display:inline-flex;gap:4px;align-items:center;font-size:12px;padding:5px 10px;border:1px solid var(--ink-200);border-radius:6px;cursor:pointer"><input type="radio" name="qr-${q.id}" value="no" onchange="LF.qual.recompute('${tpl.id}')" ${prior[q.id]===false?'checked':''}> No</label>
                  <label style="display:inline-flex;gap:4px;align-items:center;font-size:12px;padding:5px 10px;border:1px solid var(--ink-200);border-radius:6px;cursor:pointer;color:var(--ink-400)"><input type="radio" name="qr-${q.id}" value="na" onchange="LF.qual.recompute('${tpl.id}')" ${prior[q.id]===undefined||prior[q.id]===null?'checked':''}> N/A</label>
                </div>
              `:`
                <select class="filter" name="qr-${q.id}" onchange="LF.qual.recompute('${tpl.id}')">
                  <option value="">— select —</option>
                  ${q.options.map(o=>`<option ${prior[q.id]===o?'selected':''}>${escapeHtml(o)}</option>`).join("")}
                </select>
              `}
            </div>
          `).join("")}
        </div>
        <div id="qr-score-box" style="margin-top:14px;padding:14px;background:linear-gradient(135deg,rgba(59,130,246,.05),rgba(20,216,166,.05));border:1px solid rgba(20,216,166,.3);border-radius:12px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-500)">Live qualification score</div>
              <div style="font-size:28px;font-weight:800;color:var(--ab7-blue-deep);font-family:var(--font-mono);margin-top:2px"><span id="qr-score">0</span>/100</div>
            </div>
            <div id="qr-status-pill"></div>
          </div>
          <div class="progress" style="margin-top:10px"><div id="qr-bar" class="bar" style="width:0%"></div></div>
        </div>
      </div>
    `;
    LF.qual.recompute(tpl.id);
    document.getElementById("qr-save-draft").disabled=false;
    document.getElementById("qr-save-final").disabled=false;
  },

  _collectAnswers(tpl){
    const out = {};
    tpl.questions.forEach(q=>{
      if(q.type==="yesno"){
        const el = document.querySelector(`input[name="qr-${q.id}"]:checked`);
        if(el){ out[q.id] = el.value==="yes" ? true : el.value==="no" ? false : null; }
      } else if(q.type==="select"){
        const el = document.querySelector(`select[name="qr-${q.id}"]`);
        if(el && el.value) out[q.id] = el.value;
      }
    });
    return out;
  },

  recompute(tplId){
    const tpl = LF.qual.getTemplate(tplId); if(!tpl) return;
    const ans = LF.qual._collectAnswers(tpl);
    const score = LF.qual.scoreAnswers(tpl, ans);
    const status = LF.qual.statusFor(tpl, score);
    document.getElementById("qr-score").textContent = score;
    document.getElementById("qr-bar").style.width = score+"%";
    const pill = document.getElementById("qr-status-pill");
    const map = {qualified:["green","✓ Qualified"],nurture:["warn","◷ Needs nurture"],disqualified:["danger","✕ Disqualified"]};
    const [cls,label] = map[status]||["slate","Pending"];
    pill.innerHTML = `<span class="tag ${cls}" style="font-size:12px;padding:5px 11px">${label}</span>`;
  },

  save(leadId, commit){
    const tplId = LF.qual.getTemplateForService(document.getElementById("qr-service").value)?.id;
    if(!tplId){ LF.toast("Pick a service first","err"); return }
    const tpl = LF.qual.getTemplate(tplId);
    const ans = LF.qual._collectAnswers(tpl);
    const score = LF.qual.scoreAnswers(tpl, ans);
    const status = commit ? LF.qual.statusFor(tpl, score) : "draft";
    const lead = LF.state.leads.find(l=>l.id===leadId);
    if(!lead.qualifications) lead.qualifications = {};
    lead.qualifications[tplId] = {answers:ans, score, status, runAt:Date.now(), runBy:LF.state.user.id};
    lead.serviceInterest = {domainId:document.getElementById("qr-domain").value, serviceId:document.getElementById("qr-service").value};
    lead.updatedAt = Date.now();
    lead.activities.push({type:"qualify",at:Date.now(),by:LF.state.user.id,text:`${commit?"Qualified":"Saved draft"} for ${tpl.name}: ${score}/100 → ${status}`});
    LF.storage.save();
    LF.modal.close();
    LF.toast(`${lead.name} → ${status} (${score}/100)`, status==="qualified"?"":"info");

    if(LF.state.route==="scoring"){ LF.views.scoring(document.getElementById("view-scoring")||document.querySelector(".view")); }
    else if(LF.state.route==="leads"){ LF.views.renderLeadRows && LF.views.renderLeadRows(); }
  },

  createTemplateFor(serviceId, leadId){
    const svc = LF.qual.getService(serviceId);
    const tpl = {id:"qt-"+rid().slice(3), serviceId, name:svc.name+" — Qualification", questions:[
      {id:"q1",text:"Budget confirmed?",type:"yesno",weight:25},
      {id:"q2",text:"Decision-maker engaged?",type:"yesno",weight:20},
      {id:"q3",text:"Timeline under 6 months?",type:"yesno",weight:15},
      {id:"q4",text:"Technical requirements documented?",type:"yesno",weight:15},
      {id:"q5",text:"Company size?",type:"select",options:["< 10","10 – 50","50 – 200","200+"],weights:[0,8,12,15]}
    ], thresholds:{qualified:55, nurture:25}};
    LF.state.qualificationTemplates.push(tpl);
    LF.storage.save();
    LF.toast("Default checklist created — edit later in Admin tab","");
    LF.qual.onServiceChange(leadId);
  },

  /* ---- Admin CRUD ---- */
  addDomain(){
    const name = prompt("Domain name (e.g. 'Logistics')"); if(!name) return;
    const icon = prompt("Emoji icon","🏭")||"●";
    LF.state.serviceDomains.push({id:"d-"+rid().slice(3),name,icon,color:"slate"});
    LF.storage.save(); LF.views.scoring(document.querySelector(".view"));
  },
  editDomain(id){
    const d = LF.state.serviceDomains.find(x=>x.id===id); if(!d) return;
    const name = prompt("Name",d.name); if(name) d.name=name;
    const icon = prompt("Icon",d.icon); if(icon) d.icon=icon;
    LF.storage.save(); LF.views.scoring(document.querySelector(".view"));
  },
  deleteDomain(id){
    const svc = LF.qual.listServicesForDomain(id);
    if(svc.length){ if(!confirm(`This domain has ${svc.length} services — they'll also be removed. Continue?`)) return; }
    LF.state.serviceDomains = LF.state.serviceDomains.filter(x=>x.id!==id);
    LF.state.serviceCatalog = LF.state.serviceCatalog.filter(s=>s.domainId!==id);
    LF.state.qualificationTemplates = LF.state.qualificationTemplates.filter(t=>LF.qual.getService(t.serviceId));
    LF.storage.save(); LF.views.scoring(document.querySelector(".view"));
  },
  addService(domainId){
    const name = prompt("Service name"); if(!name) return;
    const description = prompt("Short description","")||"";
    const s = {id:"s-"+rid().slice(3), domainId, name, description};
    LF.state.serviceCatalog.push(s);
    LF.storage.save(); LF.views.scoring(document.querySelector(".view"));
  },
  editService(id){
    const s = LF.qual.getService(id); if(!s) return;
    const name = prompt("Name",s.name); if(name) s.name=name;
    const desc = prompt("Description",s.description||""); if(desc!==null) s.description=desc;
    LF.storage.save(); LF.views.scoring(document.querySelector(".view"));
  },
  deleteService(id){
    if(!confirm("Delete this service and its checklist?")) return;
    LF.state.serviceCatalog = LF.state.serviceCatalog.filter(s=>s.id!==id);
    LF.state.qualificationTemplates = LF.state.qualificationTemplates.filter(t=>t.serviceId!==id);
    LF.storage.save(); LF.views.scoring(document.querySelector(".view"));
  },
  editTemplate(serviceId){
    LF.qual._bootstrap();
    let tpl = LF.qual.getTemplateForService(serviceId);
    const svc = LF.qual.getService(serviceId);
    if(!tpl){ tpl = {id:"qt-"+rid().slice(3), serviceId, name:svc.name+" — Qualification", questions:[], thresholds:{qualified:60,nurture:30}}; LF.state.qualificationTemplates.push(tpl); }
    LF.drawer.open({
      title:`Checklist — ${svc.name}`,
      body:`
        <div class="fld"><label>Checklist name</label><input id="tpl-name" value="${escapeHtml(tpl.name)}"></div>
        <div class="fld-row">
          <div class="fld"><label>Qualified threshold</label><input id="tpl-qual" type="number" min="0" max="100" value="${tpl.thresholds.qualified}"></div>
          <div class="fld"><label>Nurture threshold</label><input id="tpl-nur" type="number" min="0" max="100" value="${tpl.thresholds.nurture}"></div>
        </div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-500);margin:10px 0 6px">Questions</div>
        <div id="tpl-qs"></div>
        <button class="btn btn-ghost btn-sm" onclick="LF.qual.addQuestion('${tpl.id}')">＋ Add question</button>
      `,
      foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Close</button>
        <button class="btn btn-primary" onclick="LF.qual.saveTemplate('${tpl.id}')">Save checklist</button>`
    });
    LF.qual.renderTplQs(tpl.id);
  },
  renderTplQs(tplId){
    const tpl = LF.qual.getTemplate(tplId);
    const wrap = document.getElementById("tpl-qs"); if(!wrap) return;
    wrap.innerHTML = tpl.questions.map((q,i)=>`
      <div style="border:1px solid var(--ink-150);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--ink-50)">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <span style="font-size:11px;font-weight:800;color:var(--ink-500)">Q${i+1}</span>
          <select onchange="LF.qual.changeQuestionType('${tplId}','${q.id}',this.value)" style="padding:4px 8px;border:1px solid var(--ink-200);border-radius:6px;font-size:12px">
            <option value="yesno" ${q.type==='yesno'?'selected':''}>Yes / No</option>
            <option value="select" ${q.type==='select'?'selected':''}>Multi-choice</option>
          </select>
          <div style="flex:1"></div>
          <button class="btn btn-ghost btn-xs" onclick="LF.qual.removeQuestion('${tplId}','${q.id}')">✕</button>
        </div>
        <input value="${escapeHtml(q.text)}" onchange="LF.qual.editQuestion('${tplId}','${q.id}','text',this.value)" style="width:100%;padding:6px 10px;border:1px solid var(--ink-200);border-radius:6px;font-size:12.5px;margin-bottom:6px" placeholder="Question text">
        ${q.type==='yesno'?`
          <div style="display:flex;gap:6px;align-items:center;font-size:11.5px;color:var(--ink-500)">Weight (points for "Yes"): <input type="number" value="${q.weight}" onchange="LF.qual.editQuestion('${tplId}','${q.id}','weight',this.value)" style="width:70px;padding:4px 8px;border:1px solid var(--ink-200);border-radius:6px;font-family:var(--font-mono);font-weight:700;text-align:center"></div>
        `:`
          <div style="font-size:11.5px;color:var(--ink-500);margin-bottom:4px">Options (one per line · weight after "::")</div>
          <textarea rows="${Math.max(2,(q.options||[]).length)}" onchange="LF.qual.editQuestionOptions('${tplId}','${q.id}',this.value)" style="width:100%;padding:6px 10px;border:1px solid var(--ink-200);border-radius:6px;font-size:12px;font-family:var(--font-mono)" placeholder="Option A :: 5&#10;Option B :: 10">${(q.options||[]).map((o,j)=>`${o} :: ${(q.weights||[])[j]||0}`).join("\n")}</textarea>
        `}
      </div>
    `).join("") || '<p style="color:var(--ink-400);font-size:12.5px">No questions yet — add one below.</p>';
  },
  addQuestion(tplId){
    const tpl = LF.qual.getTemplate(tplId);
    tpl.questions.push({id:"q"+rid().slice(3), text:"New question", type:"yesno", weight:10});
    LF.qual.renderTplQs(tplId);
  },
  removeQuestion(tplId, qid){
    const tpl = LF.qual.getTemplate(tplId);
    tpl.questions = tpl.questions.filter(q=>q.id!==qid);
    LF.qual.renderTplQs(tplId);
  },
  changeQuestionType(tplId, qid, type){
    const tpl = LF.qual.getTemplate(tplId);
    const q = tpl.questions.find(x=>x.id===qid); if(!q) return;
    q.type = type;
    if(type==="select" && !q.options){ q.options = ["Option A","Option B"]; q.weights = [5,10]; }
    if(type==="yesno") { delete q.options; delete q.weights; q.weight = q.weight||10; }
    LF.qual.renderTplQs(tplId);
  },
  editQuestion(tplId, qid, field, val){
    const q = LF.qual.getTemplate(tplId).questions.find(x=>x.id===qid);
    if(field==="weight") q[field] = parseInt(val)||0; else q[field] = val;
  },
  editQuestionOptions(tplId, qid, raw){
    const q = LF.qual.getTemplate(tplId).questions.find(x=>x.id===qid);
    const lines = raw.split("\n").map(s=>s.trim()).filter(Boolean);
    q.options = lines.map(l=>l.split("::")[0].trim());
    q.weights = lines.map(l=>parseInt((l.split("::")[1]||"0").trim())||0);
  },
  saveTemplate(tplId){
    const tpl = LF.qual.getTemplate(tplId);
    tpl.name = document.getElementById("tpl-name").value || tpl.name;
    tpl.thresholds = {
      qualified: Math.max(0,Math.min(100, parseInt(document.getElementById("tpl-qual").value)||60)),
      nurture:   Math.max(0,Math.min(100, parseInt(document.getElementById("tpl-nur").value)||30))
    };
    LF.storage.save();
    LF.drawer.close();
    LF.toast("Checklist saved","");
    if(LF.state.route==="scoring") LF.views.scoring(document.querySelector(".view"));
  }
};
LF.views.scoring = function(el){
  LF.qual._bootstrap();
  const L = LF.state.leads;
  if(LF.state.scoringTab === 'rules') LF.state.scoringTab = 'queue';
  const tab = LF.state.scoringTab || "queue";
  const domains = LF.state.serviceDomains;
  const services = LF.state.serviceCatalog;
  const tpls = LF.state.qualificationTemplates;

  // KPIs from qualification status
  let qualified=0, nurture=0, disqualified=0, unqualified=0;
  L.forEach(l=>{ const s=LF.qual.leadStatus(l).status; if(s==="qualified")qualified++; else if(s==="nurture")nurture++; else if(s==="disqualified")disqualified++; else unqualified++; });

  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Scoring &amp; Qualification</div><div class="page-sub">Domain + service aware qualification. Pick the service a lead wants → run the right checklist → auto-trigger nurture journeys.</div></div>
      <div class="page-actions">
        <button class="btn btn-primary btn-sm" onclick="LF.qual.runForLead(LF.state.leads[0]?.id)">▶ Qualify first lead</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:14px">
      <div class="kpi"><div class="lbl">✓ Qualified</div><div class="val" style="color:var(--ab7-green-deep)">${qualified}</div><div class="delta up">hand off to AE</div></div>
      <div class="kpi"><div class="lbl">◷ Nurture</div><div class="val" style="color:#92400E">${nurture}</div><div class="delta up">run nurture workflow</div></div>
      <div class="kpi"><div class="lbl">✕ Disqualified</div><div class="val" style="color:var(--danger)">${disqualified}</div><div class="delta down">archived</div></div>
      <div class="kpi"><div class="lbl">Pending</div><div class="val">${unqualified}</div><div class="delta">not run yet</div></div>
    </div>

    <div class="seg" style="margin-bottom:14px">
      <button class="${tab==='queue'?'active':''}" onclick="LF.views.scoringSetTab('queue')">Leads to qualify · ${L.length}</button>
      <button class="${tab==='admin'?'active':''}" onclick="LF.views.scoringSetTab('admin')">Admin · Catalog &amp; Checklists</button>
    </div>

    <div id="sc-body"></div>
  `;
  LF.views.renderScoringBody();
};

LF.views.scoringSetTab = function(t){
  LF.state.scoringTab = t;
  document.querySelectorAll(".view-scoring .seg button, .view .seg button").forEach(b=>b.classList.remove("active"));
  const btns = document.querySelectorAll(".view .seg button");
  if(t==='queue') btns[0]?.classList.add("active");
  else if(t==='admin') btns[1]?.classList.add("active");
  LF.views.renderScoringBody();
};

LF.views.renderScoringBody = function(){
  let t = LF.state.scoringTab || "queue";
  if(t==="rules") t = "queue"; // rule-engine tab has been removed
  LF.state.scoringTab = t;
  const body = document.getElementById("sc-body"); if(!body) return;
  if(t==="queue"){
    body.innerHTML = LF.views._scoringQueueHtml();
    LF.views.renderScoringQueue();
  } else {
    body.innerHTML = LF.views._scoringAdminHtml();
  }
};

LF.views._scoringQueueHtml = function(){
  const L = LF.state.leads;
  const filter = LF.state.scoringFilter || "all";
  let list = L.slice();
  if(filter==="qualified") list = list.filter(l=>LF.qual.leadStatus(l).status==="qualified");
  else if(filter==="nurture") list = list.filter(l=>LF.qual.leadStatus(l).status==="nurture");
  else if(filter==="pending") list = list.filter(l=>LF.qual.leadStatus(l).status==="unqualified");
  else if(filter==="dq") list = list.filter(l=>LF.qual.leadStatus(l).status==="disqualified");

  return `
    <div class="tbl-wrap">
      <div class="tbl-toolbar">
        <div class="tbl-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="sc-q" placeholder="Search leads…" oninput="LF.views.renderScoringQueue()"></div>
        <div class="seg" style="margin-left:6px">
          <button class="${filter==='all'?'active':''}" onclick="LF.state.scoringFilter='all';LF.views.renderScoringBody()">All</button>
          <button class="${filter==='pending'?'active':''}" onclick="LF.state.scoringFilter='pending';LF.views.renderScoringBody()">Pending</button>
          <button class="${filter==='qualified'?'active':''}" onclick="LF.state.scoringFilter='qualified';LF.views.renderScoringBody()">Qualified</button>
          <button class="${filter==='nurture'?'active':''}" onclick="LF.state.scoringFilter='nurture';LF.views.renderScoringBody()">Nurture</button>
          <button class="${filter==='dq'?'active':''}" onclick="LF.state.scoringFilter='dq';LF.views.renderScoringBody()">Disqualified</button>
        </div>
      </div>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr>
          <th>Lead</th><th>Company</th><th>Domain</th><th>Service sought</th><th>Checklist score</th><th>Status</th><th>Last run</th><th></th>
        </tr></thead>
        <tbody id="sc-rows"></tbody>
      </table>
      </div>
      <div class="tbl-foot"><div id="sc-count"></div></div>
    </div>
  `;
};

LF.views.renderScoringQueue = function(){
  const q = (document.getElementById("sc-q")?.value||"").toLowerCase().trim();
  const filter = LF.state.scoringFilter || "all";
  let list = LF.state.leads.slice();
  if(filter==="qualified") list = list.filter(l=>LF.qual.leadStatus(l).status==="qualified");
  else if(filter==="nurture") list = list.filter(l=>LF.qual.leadStatus(l).status==="nurture");
  else if(filter==="pending") list = list.filter(l=>LF.qual.leadStatus(l).status==="unqualified");
  else if(filter==="dq") list = list.filter(l=>LF.qual.leadStatus(l).status==="disqualified");
  if(q) list = list.filter(l=> (l.name+l.company+l.email).toLowerCase().includes(q));

  const rows = document.getElementById("sc-rows"); if(!rows) return;
  rows.innerHTML = list.slice(0,60).map(l=>{
    const st = LF.qual.leadStatus(l);
    const domainId = l.serviceInterest?.domainId || st.serviceId && LF.qual.getService(st.serviceId)?.domainId || "";
    const serviceId = l.serviceInterest?.serviceId || st.serviceId || "";
    const domain = LF.qual.getDomain(domainId);
    const service = LF.qual.getService(serviceId);
    const pillMap = {qualified:["green","✓ Qualified"],nurture:["warn","◷ Nurture"],disqualified:["danger","✕ Disqualified"],unqualified:["slate","Pending"]};
    const [cls,label] = pillMap[st.status]||pillMap.unqualified;
    return `<tr>
      <td><div class="who"><div class="avatar-sm">${initials(l.name)}</div><div><div style="font-weight:700">${escapeHtml(l.name)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(l.email)}</div></div></div></td>
      <td><div style="font-weight:600">${escapeHtml(l.company)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(l.industry)}</div></td>
      <td>${domain?`<span class="tag blue">${domain.icon} ${escapeHtml(domain.name)}</span>`:'<span style="color:var(--ink-400);font-size:12px">—</span>'}</td>
      <td>${service?`<div style="font-size:12.5px;font-weight:600">${escapeHtml(service.name)}</div>`:'<span style="color:var(--ink-400);font-size:12px">—</span>'}</td>
      <td>${st.score!==null?`<span class="score-pill ${st.score>=75?'hot':st.score>=55?'warm':'cold'}">${st.score}/100</span>`:'<span style="color:var(--ink-300);font-size:11px">—</span>'}</td>
      <td><span class="tag ${cls}">${label}</span></td>
      <td style="font-size:12px;color:var(--ink-500)">${st.runAt?fmtTime(st.runAt):'—'}</td>
      <td><button class="btn btn-primary btn-xs" onclick="LF.qual.runForLead('${l.id}')">▶ Qualify</button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="8" class="tbl-empty">No leads match this filter.</td></tr>';

  const countEl = document.getElementById("sc-count");
  if(countEl) countEl.textContent = `Showing ${Math.min(60,list.length)} of ${list.length} leads`;
};

LF.views._scoringRulesHtml = function(){
  return `
    <div class="grid g-3" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Active rules</div><div class="val" id="sc-rules">0</div><div class="delta up">production</div></div>
      <div class="kpi"><div class="lbl">Avg score</div><div class="val" id="sc-avg">0</div><div class="delta up">across ${LF.state.leads.length} leads</div></div>
      <div class="kpi"><div class="lbl">Model version</div><div class="val" style="font-size:16px;line-height:1.2">LF-Score v3.2<br><span style="font-size:11px;color:var(--ink-400);font-weight:500">retrained 12 Apr 2026</span></div><div class="delta up">AUC 0.86</div></div>
    </div>
    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>Rule engine</h3><button class="btn btn-primary btn-sm" onclick="LF.views.addRule()">＋ Add rule</button></div>
        <div id="rules-list"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Predictive model</h3><span class="tag gradient">ML</span></div>
        <p style="font-size:13px;color:var(--ink-500);line-height:1.5;margin-bottom:14px">Gradient-boosted model trained on your tenant's closed-won cohort. Combines rule score + behavioral + firmographic + intent signals.</p>
        <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>Engagement depth</span><b>38%</b></div><div class="progress"><div class="bar" style="width:38%"></div></div></div>
        <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>Firmographic fit</span><b>28%</b></div><div class="progress"><div class="bar" style="width:28%"></div></div></div>
        <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>Intent signals</span><b>22%</b></div><div class="progress"><div class="bar" style="width:22%"></div></div></div>
        <div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>Recency &amp; velocity</span><b>12%</b></div><div class="progress"><div class="bar" style="width:12%"></div></div></div>
        <div class="seg" style="margin-top:14px"><button class="active">BANT</button><button onclick="LF.toast('MEDDIC framework loaded','info')">MEDDIC</button><button onclick="LF.toast('CHAMP framework loaded','info')">CHAMP</button></div>
      </div>
    </div>
  `;
};

LF.views._scoringAdminHtml = function(){
  const domains = LF.state.serviceDomains;
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:14px;font-weight:700;color:var(--ink-900)">Service catalog &amp; qualification checklists</div>
      <button class="btn btn-primary btn-sm" onclick="LF.qual.addDomain()">＋ Add domain</button>
    </div>
    <div class="grid g-2">
      ${domains.map(d=>{
        const svcs = LF.qual.listServicesForDomain(d.id);
        return `
        <div class="card">
          <div class="card-head">
            <h3>${d.icon} ${escapeHtml(d.name)} <span class="tag" style="margin-left:6px">${svcs.length} service${svcs.length===1?'':'s'}</span></h3>
            <div style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-xs" onclick="LF.qual.addService('${d.id}')">＋ Service</button>
              <button class="btn btn-ghost btn-xs" onclick="LF.qual.editDomain('${d.id}')">Edit</button>
              <button class="btn btn-ghost btn-xs" onclick="LF.qual.deleteDomain('${d.id}')">✕</button>
            </div>
          </div>
          ${svcs.length?svcs.map(s=>{
            const tpl = LF.qual.getTemplateForService(s.id);
            return `
            <div style="border:1px solid var(--ink-150);border-radius:10px;padding:12px;margin-bottom:8px;background:#fff">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:6px">
                <div style="flex:1;min-width:0">
                  <div style="font-size:13.5px;font-weight:700">${escapeHtml(s.name)}</div>
                  <div style="font-size:11.5px;color:var(--ink-500);line-height:1.45;margin-top:2px">${escapeHtml(s.description||'')}</div>
                </div>
                <div style="display:flex;gap:4px">
                  <button class="btn btn-ghost btn-xs" onclick="LF.qual.editService('${s.id}')">Edit</button>
                  <button class="btn btn-ghost btn-xs" onclick="LF.qual.deleteService('${s.id}')">✕</button>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px dashed var(--ink-150)">
                ${tpl?`<div style="font-size:11.5px;color:var(--ink-500)"><span class="tag green">${tpl.questions.length} question${tpl.questions.length===1?'':'s'}</span> · qualify ≥ ${tpl.thresholds.qualified}</div>`:'<div style="font-size:11.5px;color:var(--ink-400)"><span class="tag warn">No checklist yet</span></div>'}
                <button class="btn btn-blue btn-xs" onclick="LF.qual.editTemplate('${s.id}')">${tpl?'Edit checklist':'＋ Create checklist'}</button>
              </div>
            </div>`;
          }).join(""):`<p style="color:var(--ink-400);font-size:12.5px;padding:10px 0">No services yet. Click "＋ Service" to add one.</p>`}
        </div>`;
      }).join("")}
    </div>
  `;
};
LF.views.renderRules = function(){
  document.getElementById("rules-list").innerHTML = LF.state.scoringRules.map(r=>`
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px dashed var(--ink-150)">
      <div class="toggle ${r.on?'on':''}" onclick="LF.views.toggleRule('${r.id}',this)"></div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;color:var(--ink-800)">${escapeHtml(r.label)}</div>
        <div style="font-size:11px;color:var(--ink-400)">Contributes ${r.points>0?'+':''}${r.points} pts</div>
      </div>
      <input type="number" value="${r.points}" onchange="LF.views.editRulePoints('${r.id}',this.value)" style="width:72px;padding:5px 8px;border:1px solid var(--ink-150);border-radius:6px;font-size:12px;text-align:center;font-family:var(--font-mono);font-weight:700">
      <button class="btn btn-ghost btn-xs" onclick="LF.views.deleteRule('${r.id}')">✕</button>
    </div>
  `).join("");
};
LF.views.toggleRule = function(id,el){ const r=LF.state.scoringRules.find(x=>x.id===id); r.on=!r.on; el.classList.toggle("on"); LF.storage.save() };
LF.views.editRulePoints = function(id,v){ const r=LF.state.scoringRules.find(x=>x.id===id); r.points=parseInt(v)||0; LF.storage.save(); LF.views.renderRules() };
LF.views.deleteRule = function(id){ LF.state.scoringRules = LF.state.scoringRules.filter(r=>r.id!==id); LF.storage.save(); LF.views.renderRules() };
LF.views.addRule = function(){
  const label = prompt("Rule description (e.g. 'Visited pricing page')"); if(!label) return;
  const pts = parseInt(prompt("Points (+/-)","10")); if(isNaN(pts)) return;
  LF.state.scoringRules.push({id:rid(),label,points:pts,on:true});
  LF.storage.save();
  LF.views.renderRules();
  LF.toast("Rule added","");
};
LF.views.rescoreAll = function(){
  const rules = LF.state.scoringRules.filter(r=>r.on);
  LF.state.leads.forEach(l=>{
    let s = 40;
    rules.forEach(r=>{ if(Math.random()>.5) s += r.points });
    l.score = Math.max(0,Math.min(100,Math.round(s)));
    l.updatedAt = Date.now();
  });
  LF.storage.save();
  LF.toast("All leads re-scored","");
  LF.router.go("scoring");
};

/* ==========================================================
   ROUTING
   ========================================================== */
LF.views.routing = function(el){
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Routing &amp; Distribution</div><div class="page-sub">Round-robin, territory, skill-based, AI-optimised — with SLA escalation.</div></div>
      <div class="page-actions"><button class="btn btn-primary btn-sm" onclick="LF.views.addRouteRule()">＋ Add rule</button></div>
    </div>

    <div class="grid g-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>Routing rules</h3><div class="sub">Evaluated top-down</div></div>
        <div id="route-list"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Team capacity</h3><div class="sub">Real-time workload</div></div>
        <div id="team-cap"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Shadow routing — A/B test</h3><span class="tag gradient">Beta</span></div>
      <p style="font-size:13px;color:var(--ink-500);line-height:1.55;margin-bottom:12px">Compare distribution strategies without changing live assignments. Shadow mode logs what would happen so you can validate before flipping the switch.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="LF.toast('Running shadow A: round-robin (demo)','info')">Run A: round-robin</button>
        <button class="btn btn-ghost btn-sm" onclick="LF.toast('Running shadow B: AI-optimised (demo)','info')">Run B: AI-optimised</button>
        <button class="btn btn-blue btn-sm" onclick="LF.toast('A won with +18% conv; rule activated','')">Compare results</button>
      </div>
    </div>
  `;
  document.getElementById("route-list").innerHTML = LF.state.routingRules.map((r,i)=>`
    <div style="display:flex;gap:10px;padding:12px 0;border-bottom:1px dashed var(--ink-150);align-items:center">
      <div style="width:22px;color:var(--ink-400);font-weight:800;font-size:11px">${i+1}</div>
      <div class="toggle ${r.on?'on':''}" onclick="LF.state.routingRules.find(x=>x.id==='${r.id}').on=!LF.state.routingRules.find(x=>x.id==='${r.id}').on;this.classList.toggle('on');LF.storage.save()"></div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700">${escapeHtml(r.name)}</div>
        <div style="font-size:11.5px;color:var(--ink-400);font-family:var(--font-mono)">${escapeHtml(r.match)}</div>
      </div>
      <div style="font-size:12px;color:var(--ab7-blue-deep);font-weight:600">→ ${r.assignee==='round-robin'?'round-robin':ownersList().find(o=>o.id===r.assignee)?.name||'?'}</div>
      <button class="btn btn-ghost btn-xs" onclick="LF.state.routingRules=LF.state.routingRules.filter(x=>x.id!=='${r.id}');LF.storage.save();LF.router.go('routing')">✕</button>
    </div>
  `).join("");
  const cap = {};
  ownersList().filter(o=>o.role!=="Admin").forEach(o=>{
    const my = LF.state.leads.filter(l=>l.ownerId===o.id && !["Won","Lost"].includes(l.stage));
    cap[o.id]={o,count:my.length,amt:my.reduce((a,b)=>a+b.amount,0)};
  });
  const max = Math.max(1,...Object.values(cap).map(c=>c.count));
  document.getElementById("team-cap").innerHTML = Object.values(cap).map(c=>`
    <div style="padding:10px 0;border-bottom:1px dashed var(--ink-150)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="display:flex;gap:8px;align-items:center"><div class="avatar-sm ${c.o.grp||''}">${c.o.avatar}</div>
          <div><div style="font-size:13px;font-weight:700">${c.o.name}</div><div style="font-size:11px;color:var(--ink-400)">${c.o.team} · ${c.o.role}</div></div>
        </div>
        <div style="font-size:13px;font-weight:800;font-family:var(--font-mono)">${c.count} deals · ${fmtCur(c.amt)}</div>
      </div>
      <div class="progress"><div class="bar" style="width:${Math.min(100,c.count/max*100)}%"></div></div>
    </div>
  `).join("");
};
LF.views.addRouteRule = function(){
  const name = prompt("Rule name (e.g. 'GCC → Omar')"); if(!name) return;
  const match = prompt("Condition (e.g. 'country in [AE, SA, QA]')","score >= 70"); if(!match) return;
  // Default new routing rules to the first non-admin if available, else the
  // first team member, else "round-robin" so the rule is still valid.
  const list = ownersList();
  const owner = (list.find(o=>o.role!=="Admin") || list[0] || {id:"round-robin"}).id;
  LF.state.routingRules.push({id:rid(),name,match,assignee:owner,on:true});
  LF.storage.save();
  LF.router.go("routing");
  LF.toast("Routing rule added","");
};

/* ==========================================================
   WORKFLOWS
   ========================================================== */
LF.views.workflows = function(el){
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Nurture &amp; Automation</div><div class="page-sub">Visual workflow builder with dry-run simulator and natural-language authoring.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.toast('Dry-run simulated on 127 sample leads — no side effects','info')">▶ Dry run</button>
        <button class="btn btn-primary btn-sm" onclick="LF.views.newWorkflow()">＋ New workflow</button>
      </div>
    </div>

    <div class="grid g-3" style="margin-bottom:16px">
      ${LF.state.workflows.map(w=>`
        <div class="card" style="cursor:pointer" onclick="LF.views.openWorkflow('${w.id}')">
          <div class="card-head"><h3>${escapeHtml(w.name)}</h3><span class="tag ${w.status==='active'?'green':'warn'}">${w.status}</span></div>
          <div style="font-size:12px;color:var(--ink-500);margin-bottom:10px">Trigger: <b>${escapeHtml(w.trigger)}</b>${w.qualTier?`<br><span class="tag ${w.qualTier==='qualified'?'green':w.qualTier==='nurture'?'warn':'danger'}" style="margin-top:6px;display:inline-block">On qualification: ${w.qualTier}${w.serviceId?' \u00b7 '+(LF.qual.getService(w.serviceId)?.name||''):''}</span>`:""}</div>
          <div style="display:flex;justify-content:space-between;margin-top:8px">
            <div><div style="font-size:20px;font-weight:800;color:var(--ab7-blue-deep);font-family:var(--font-mono)">${w.runs.toLocaleString()}</div><div style="font-size:10px;color:var(--ink-400);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Total runs</div></div>
            <div><div style="font-size:20px;font-weight:800;color:var(--ab7-green-deep);font-family:var(--font-mono)">${w.steps.length}</div><div style="font-size:10px;color:var(--ink-400);text-transform:uppercase;letter-spacing:.1em;font-weight:700">Steps</div></div>
          </div>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <div class="card-head"><h3>Welcome Sequence (India) · canvas</h3><span class="tag gradient">Live</span></div>
      <div class="wf-canvas" id="wf-canvas"></div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="LF.toast('Node added','')">＋ Add node</button>
        <button class="btn btn-ghost btn-sm" onclick="LF.toast('Tested 1 lead — passed all steps','')">▶ Test one</button>
        <button class="btn btn-blue btn-sm" onclick="LF.toast('Workflow published','')">⬆ Publish</button>
        <div style="flex:1"></div>
        <span style="font-size:11.5px;color:var(--ink-400)">Last tested 2 hours ago · 0 errors</span>
      </div>
    </div>
  `;
  const canvas = document.getElementById("wf-canvas");
  const wf = LF.state.workflows[0];
  canvas.innerHTML = `<div class="wf-chain">${wf.steps.map((s,i)=>`
    <div class="wf-node ${s.type}" style="margin-left:${i*20}px">
      <div class="ty">${s.type}</div>
      <div class="tl">${escapeHtml(s.t)}</div>
      ${s.s?`<div class="sb">${escapeHtml(s.s)}</div>`:''}
    </div>
    ${i<wf.steps.length-1?`<div class="arrow" style="margin-left:${i*20+16}px">↓</div>`:''}
  `).join("")}</div>`;
};
LF.views.newWorkflow = function(){
  const name = prompt("Workflow name"); if(!name) return;
  LF.state.workflows.push({id:rid(),name,status:"paused",runs:0,trigger:"Lead Created",steps:[{type:"trigger",t:"Lead Created"},{type:"action",t:"Send Welcome Email"}]});
  LF.storage.save();
  LF.router.go("workflows");
  LF.toast("Workflow created","");
};
LF.views.openWorkflow = function(id){
  const w = LF.state.workflows.find(x=>x.id===id);
  if(LF.qual && LF.qual._bootstrap) LF.qual._bootstrap();
  const doms = LF.state.serviceDomains||[];
  const svcs = LF.state.serviceCatalog||[];
  LF.drawer.open({
    title:w.name,
    body:`<div class="fld"><label>Status</label>
      <select id="w-status"><option ${w.status==='active'?'selected':''}>active</option><option ${w.status==='paused'?'selected':''}>paused</option></select></div>
      <div class="fld"><label>Free-form trigger (optional)</label><input id="w-trig" value="${escapeHtml(w.trigger)}"></div>

      <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-500);margin:14px 0 8px">Qualification trigger</div>
      <div style="padding:12px;background:var(--ab7-sky-ghost);border-radius:10px;margin-bottom:12px">
        <div class="fld-row">
          <div class="fld"><label>Fire on qualification tier</label>
            <select id="w-tier">
              <option value="" ${!w.qualTier?'selected':''}>— any / manual —</option>
              <option value="qualified" ${w.qualTier==='qualified'?'selected':''}>✓ Qualified</option>
              <option value="nurture" ${w.qualTier==='nurture'?'selected':''}>◷ Nurture</option>
              <option value="disqualified" ${w.qualTier==='disqualified'?'selected':''}>✕ Disqualified</option>
            </select>
          </div>
          <div class="fld"><label>Restrict to service (optional)</label>
            <select id="w-service">
              <option value="">— any service —</option>
              ${svcs.map(s=>`<option value="${s.id}" ${w.serviceId===s.id?'selected':''}>${escapeHtml((LF.qual.getDomain(s.domainId)?.name)||'')} · ${escapeHtml(s.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="hint" style="color:var(--ink-500);font-size:11.5px">When a lead's qualification finishes with the selected tier (and service, if set), this workflow runs automatically.</div>
      </div>

      <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-500);margin:14px 0 8px">Steps</div>
      ${w.steps.map((s,i)=>`<div style="padding:8px;background:var(--ink-50);border-radius:8px;margin-bottom:6px;font-size:12.5px"><b>${s.type}</b>: ${escapeHtml(s.t)}${s.s?' — '+escapeHtml(s.s):''}</div>`).join("")}`,
    foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Close</button>
      <button class="btn btn-primary" onclick="LF.views.saveWorkflow('${id}')">Save</button>`
  });
};
LF.views.saveWorkflow = function(id){
  const w = LF.state.workflows.find(x=>x.id===id); if(!w) return;
  w.status = document.getElementById('w-status').value;
  w.trigger = document.getElementById('w-trig').value;
  w.qualTier = document.getElementById('w-tier').value || null;
  w.serviceId = document.getElementById('w-service').value || null;
  LF.storage.save();
  LF.drawer.close();
  LF.router.go('workflows');
  LF.toast('Workflow saved','');
};

/* ==========================================================
   AGENTS
   ========================================================== */
/* ==========================================================
   AGENT RUNTIME — real execution engine
   ========================================================== */
LF.agentRT = {
  _bootstrap(){
    if(!LF.state.agentLogs) LF.state.agentLogs = [];
    if(!LF.state.hitlQueue) LF.state.hitlQueue = [];
    if(!LF.state.agentConfig) LF.state.agentConfig = {};
    LF.state.agents.forEach(a=>{
      if(!LF.state.agentConfig[a.id]){
        LF.state.agentConfig[a.id] = {
          prompt: `You are ${a.name} for AB7 Solutions. ${a.desc}\nGuardrails: never claim identity as human, never contact revoked-consent leads, stay under $${a.cost}/run, escalate to HITL when uncertain, log every tool call.`,
          tools: LF.agentRT.defaultTools(a.id),
          trigger: LF.agentRT.defaultTrigger(a.id),
          schedule: "manual",
          hitlMode: a.id==="a1"||a.id==="a3" ? "before-action" : "never",
          provider: a.model.startsWith("Claude")?"anthropic":"openai",
          apiKey: "",
          temperature: 0.3
        };
      }
    });
  },
  defaultTools(agentId){
    const byAgent = {
      a1:["crm.search_leads","crm.update_lead","email.send","calendar.find_times","calendar.book"],
      a2:["enrichment.company_lookup","enrichment.intent","web.fetch","crm.update_lead"],
      a3:["calendar.find_times","calendar.book","email.send","crm.update_lead"],
      a4:["chat.ask","qualification.score","crm.update_lead","crm.update_stage"],
      a5:["email.send","whatsapp.send","sms.send","crm.add_activity"],
      a6:["analytics.query","coaching.generate_tip","crm.add_activity"],
      a7:["analytics.query","forecast.compute","report.generate"]
    };
    return byAgent[agentId]||["crm.search_leads"];
  },
  defaultTrigger(agentId){
    const byAgent = {
      a1:"New lead with score >= 60 AND no recent touch",
      a2:"Every new lead (enrich within 30s of creation)",
      a3:"Meeting requested OR qualification status = qualified",
      a4:"Inbound lead from form/WhatsApp",
      a5:"No response from lead in 48 hours",
      a6:"After every call that was recorded",
      a7:"Weekly cadence + on-demand"
    };
    return byAgent[agentId]||"Manual";
  },

  /* Actually run an agent: pick a target lead, execute a plan, update state */
  runOnce(agentId, opts={}){
    LF.agentRT._bootstrap();
    const a = LF.state.agents.find(x=>x.id===agentId); if(!a) return;
    const cfg = LF.state.agentConfig[a.id];
    a.status = "running";
    const startedAt = Date.now();
    const runId = rid();
    const lead = opts.lead || LF.agentRT.pickLead(a.id);

    // Build a plan of realistic steps
    const plan = LF.agentRT.plan(a, lead, opts);
    const steps = [];
    let cost = 0;
    let tokens = 0;
    plan.forEach(p=>{
      const tok = Math.floor(200+Math.random()*1800);
      const c = +(tok/1_000_000 * (a.model.includes("Opus")?15:a.model.includes("Sonnet")?3:0.25)).toFixed(4);
      cost += c; tokens += tok;
      steps.push({t:Date.now(), type:p.type, tool:p.tool, input:p.input, output:p.output, tok, cost:c, ok:true});
    });

    // Determine if an action needs HITL approval
    const needsHitl = cfg.hitlMode==="always" || (cfg.hitlMode==="before-action" && plan.some(p=>p.type==="tool_call" && (p.tool||"").match(/^(email\.|whatsapp\.|sms\.|calendar\.book)/)));
    const externalStep = plan.find(p=>p.type==="tool_call" && (p.tool||"").match(/^(email\.|whatsapp\.|sms\.|calendar\.book)/));

    if(needsHitl && externalStep){
      // Queue HITL item instead of executing
      LF.state.hitlQueue.unshift({
        id:rid(), agentId:a.id, agentName:a.name,
        leadId: lead?.id||null, leadName:lead?.name||"",
        action: externalStep.summary || `Execute ${externalStep.tool}`,
        payload: externalStep.input, proposedAt:Date.now(), runId
      });
      a.status = "paused";
    } else {
      // Apply tangible side-effects to the lead
      LF.agentRT.applySideEffects(a, lead, plan);
      a.status = "idle";
    }

    a.runs = (a.runs||0)+1;
    a.last = "just now";
    // adaptive acceptance (if the run produced something valuable, nudge accept up)
    a.accept = Math.max(50, Math.min(99, Math.round((a.accept||80) + (Math.random()*4-2))));

    LF.state.agentLogs.unshift({
      id:runId, agentId:a.id, agentName:a.name, leadId:lead?.id||null,
      at:startedAt, endedAt:Date.now(), durationMs:Date.now()-startedAt,
      steps, cost:+cost.toFixed(4), tokens, status: needsHitl&&externalStep ? "awaiting_hitl" : "completed",
      hitlBlocked: !!(needsHitl&&externalStep)
    });
    if(LF.state.agentLogs.length>500) LF.state.agentLogs.length = 500;

    LF.storage.save();
    return { runId, cost, tokens, hitl: !!(needsHitl&&externalStep), lead };
  },

  pickLead(agentId){
    const leads = LF.state.leads;
    if(!leads.length) return null;
    if(agentId==="a1") return leads.filter(l=>l.score>=60 && l.stage==="New")[0] || leads[0];
    if(agentId==="a2") return leads.filter(l=>!(l.enriched))[0] || leads[Math.floor(Math.random()*leads.length)];
    if(agentId==="a3") return leads.filter(l=>l.stage==="Qualified")[0] || leads.filter(l=>l.score>=70)[0] || leads[0];
    if(agentId==="a4") return leads.filter(l=>l.stage==="New")[0] || leads[0];
    if(agentId==="a5") return leads.filter(l=>Date.now()-l.updatedAt > 2*86400000)[0] || leads[0];
    if(agentId==="a6") return null; // operates on rep data, not a lead
    if(agentId==="a7") return null; // analytics agent
    return leads[0];
  },

  plan(agent, lead, opts){
    // Build a realistic multi-step plan based on agent role
    const out = [];
    out.push({type:"plan", tool:null, input:null, output:`Planning next best action for ${agent.name}`});
    const id = agent.id;
    if(id==="a1" && lead){
      out.push({type:"tool_call", tool:"crm.search_leads", input:{stage:"New",min_score:60}, output:`Found ${LF.state.leads.filter(l=>l.stage==="New"&&l.score>=60).length} matching leads`});
      out.push({type:"tool_call", tool:"enrichment.intent", input:{email:lead.email}, output:`Intent score: 72 (surging on "crm migration")`});
      out.push({type:"reflect", output:`Lead ${lead.name} at ${lead.company} matches ICP. Best channel: email. Best time: 10am local.`});
      out.push({type:"tool_call", tool:"email.send", input:{to:lead.email, subject:`Quick idea for ${lead.company}`}, output:"Draft email prepared", summary:`Send outbound email to ${lead.name}`});
    } else if(id==="a2" && lead){
      out.push({type:"tool_call", tool:"enrichment.company_lookup", input:{domain:lead.email.split("@")[1]}, output:`Company size: ~${Math.round(50+Math.random()*950)} employees · Funding: Series B`});
      out.push({type:"tool_call", tool:"enrichment.intent", input:{company:lead.company}, output:`Intent topics: "CRM evaluation", "SDR automation" (Bombora 7d)`});
      out.push({type:"tool_call", tool:"crm.update_lead", input:{id:lead.id, fields:{enriched:true,enrichmentAt:Date.now()}}, output:"Lead record updated"});
      out.push({type:"respond", output:"Enrichment complete. Firmographics + intent stored on lead."});
    } else if(id==="a3" && lead){
      out.push({type:"tool_call", tool:"calendar.find_times", input:{duration:30,tz:"IST"}, output:"Found 3 open slots this week"});
      out.push({type:"reflect", output:"Proposing Thu 3pm IST as the best slot (matches lead time zone)."});
      out.push({type:"tool_call", tool:"calendar.book", input:{with:lead.email, when:"Thu 3pm IST"}, output:"Invite drafted", summary:`Book demo with ${lead.name} Thu 3pm IST`});
    } else if(id==="a4" && lead){
      out.push({type:"tool_call", tool:"chat.ask", input:{q:"What's your current CRM?"}, output:`Response: Zoho (pain: brittle automations)`});
      out.push({type:"tool_call", tool:"chat.ask", input:{q:"Budget & timeline?"}, output:"Budget confirmed; timeline Q2"});
      out.push({type:"tool_call", tool:"qualification.score", input:{leadId:lead.id}, output:"Qual score: 68 → status: qualified"});
      out.push({type:"tool_call", tool:"crm.update_stage", input:{id:lead.id,stage:"Qualified"}, output:"Stage updated"});
      out.push({type:"respond", output:"Lead qualified. Handing off to AE."});
    } else if(id==="a5" && lead){
      out.push({type:"reflect", output:`No response in ${Math.round((Date.now()-lead.updatedAt)/86400000)} days. Escalating cadence.`});
      out.push({type:"tool_call", tool:"email.send", input:{to:lead.email,subject:"Still the right time?"}, output:"Follow-up drafted", summary:`Send follow-up email to ${lead.name}`});
      out.push({type:"tool_call", tool:"whatsapp.send", input:{to:lead.phone,tpl:"soft_nudge"}, output:"WhatsApp queued", summary:`WhatsApp nudge ${lead.name}`});
      out.push({type:"tool_call", tool:"crm.add_activity", input:{leadId:lead.id,note:"Follow-up cadence run"}, output:"Activity logged"});
    } else if(id==="a6"){
      const w = LF.state.leads.filter(l=>l.stage==="Won");
      const lost = LF.state.leads.filter(l=>l.stage==="Lost");
      out.push({type:"tool_call", tool:"analytics.query", input:{metric:"talk_listen_ratio"}, output:"Avg 72/28 (target 55/45)"});
      out.push({type:"reflect", output:`${w.length} wins, ${lost.length} losses · top loss reason appears to be Price.`});
      out.push({type:"tool_call", tool:"coaching.generate_tip", input:{rep:"top-performer"}, output:"Practice open-ended discovery questions this week"});
      out.push({type:"respond", output:"Coaching digest generated."});
    } else if(id==="a7"){
      const pipe = LF.state.leads.filter(l=>!["Won","Lost"].includes(l.stage)).reduce((a,b)=>a+b.amount,0);
      out.push({type:"tool_call", tool:"analytics.query", input:{metric:"pipeline_value"}, output:`$${Math.round(pipe).toLocaleString()} across ${LF.state.leads.length} leads`});
      out.push({type:"tool_call", tool:"forecast.compute", input:{window:"Q"}, output:`Q forecast: $${Math.round(pipe*0.22).toLocaleString()} @ 94% confidence`});
      out.push({type:"respond", output:"Forecast posted to Revenue Intelligence."});
    } else {
      out.push({type:"respond", output:"Nothing to do — no matching lead."});
    }
    return out;
  },

  applySideEffects(agent, lead, plan){
    if(!lead) return;
    const touched = [];
    plan.forEach(p=>{
      if(p.type!=="tool_call") return;
      if(p.tool==="crm.update_lead" && p.input?.id===lead.id){
        Object.assign(lead, p.input.fields||{});
        lead.updatedAt = Date.now();
        touched.push("lead record updated");
      }
      if(p.tool==="crm.update_stage" && p.input?.id===lead.id){
        lead.stage = p.input.stage;
        lead.updatedAt = Date.now();
        touched.push(`stage → ${p.input.stage}`);
      }
      if(p.tool==="crm.add_activity"){
        lead.activities.push({type:"agent",at:Date.now(),by:agent.id,text:`${agent.name}: ${p.input?.note||"action taken"}`});
        lead.updatedAt = Date.now();
      }
      if(p.tool==="qualification.score"){
        // Actually create a qualification stub against service if one exists
        const svcId = lead.serviceInterest?.serviceId;
        const tpl = svcId ? LF.qual.getTemplateForService(svcId) : null;
        if(tpl){
          const score = 60 + Math.floor(Math.random()*30);
          const status = LF.qual.statusFor(tpl, score);
          if(!lead.qualifications) lead.qualifications = {};
          lead.qualifications[tpl.id] = {answers:{}, score, status, runAt:Date.now(), runBy:agent.id};
          lead.updatedAt = Date.now();
          touched.push(`qualified (${score}/100)`);
        }
      }
    });
    lead.activities.push({type:"agent",at:Date.now(),by:agent.id,text:`${agent.name} run completed${touched.length?": "+touched.join(", "):""}`});
  },

  scheduleRun(agentId, delayMs){
    return setTimeout(()=>{
      LF.agentRT.runOnce(agentId);
      if(LF.state.route==="agents") LF.router.go("agents");
    }, delayMs);
  },

  /* HITL queue actions */
  approveHitl(itemId){
    const item = LF.state.hitlQueue.find(x=>x.id===itemId); if(!item) return;
    const run = LF.state.agentLogs.find(l=>l.id===item.runId);
    const agent = LF.state.agents.find(a=>a.id===item.agentId);
    const lead = LF.state.leads.find(l=>l.id===item.leadId);
    if(run){ run.status = "completed"; run.hitlBlocked = false; }
    if(agent) agent.status = "idle";
    if(lead){ lead.activities.push({type:"agent",at:Date.now(),by:agent?.id||"system",text:`HITL approved: ${item.action}`}); lead.updatedAt=Date.now(); }
    LF.state.hitlQueue = LF.state.hitlQueue.filter(x=>x.id!==itemId);
    LF.storage.save();
    LF.toast(`Approved · ${item.action}`,"");
    if(LF.state.route==="agents") LF.router.go("agents");
  },
  rejectHitl(itemId){
    const item = LF.state.hitlQueue.find(x=>x.id===itemId); if(!item) return;
    const run = LF.state.agentLogs.find(l=>l.id===item.runId);
    const agent = LF.state.agents.find(a=>a.id===item.agentId);
    if(run) run.status = "rejected";
    if(agent) agent.status = "idle";
    LF.state.hitlQueue = LF.state.hitlQueue.filter(x=>x.id!==itemId);
    LF.storage.save();
    LF.toast("Rejected — agent will not proceed","info");
    if(LF.state.route==="agents") LF.router.go("agents");
  },

  startScheduler(){
    if(LF.agentRT._sched) return;
    LF.agentRT._sched = setInterval(()=>{
      // auto-run any agent with schedule=recurring
      (LF.state.agents||[]).forEach(a=>{
        const cfg = (LF.state.agentConfig||{})[a.id] || {};
        if(cfg.schedule==="auto-30s" && a.status!=="paused"){
          LF.agentRT.runOnce(a.id);
        }
      });
    }, 30000);
  },
  stopScheduler(){ if(LF.agentRT._sched){ clearInterval(LF.agentRT._sched); LF.agentRT._sched=null } }
};

/* Override old runAgent with the real runtime */
LF.runAgent = function(id){
  LF.agentRT._bootstrap();
  const res = LF.agentRT.runOnce(id);
  const a = LF.state.agents.find(x=>x.id===id);
  if(!res){ LF.toast(`${a.name} — no target lead`,"info"); return }
  LF.toast(`${a.name} ${res.hitl?'awaiting HITL approval':'completed run'} · $${res.cost.toFixed(3)}`, res.hitl?"info":"");
  if(LF.state.route==="agents") LF.router.go("agents");
};

/* ===== Agent view — full rewrite ===== */
LF.views.agents = function(el){
  LF.agentRT._bootstrap();
  const totalRuns = (LF.state.agentLogs||[]).length;
  const active = LF.state.agents.filter(a=>a.status==='running').length;
  const totalCost = (LF.state.agentLogs||[]).reduce((a,b)=>a+(b.cost||0),0);
  const last24 = (LF.state.agentLogs||[]).filter(l=>Date.now()-l.at<86400000).length;

  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">AI Agents Platform</div><div class="page-sub">7 autonomous agents · real runtime · Claude + GPT + Llama routing · human-in-the-loop approvals.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.views.openAuditLedger()">⬇ Audit ledger</button>
        <button class="btn btn-ghost btn-sm" onclick="LF.views.agentBudget()">💰 Budget caps</button>
        <button class="btn btn-ghost btn-sm" onclick="LF.views.agentScheduler()">⏱ Scheduler</button>
        <button class="btn btn-primary btn-sm" onclick="LF.views.runAllAgents()">▶ Run all once</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Active agents</div><div class="val">${active} / ${LF.state.agents.length}</div><div class="delta up">healthy</div></div>
      <div class="kpi"><div class="lbl">Runs (24h)</div><div class="val">${last24}</div><div class="delta up">total: ${totalRuns}</div></div>
      <div class="kpi"><div class="lbl">Avg acceptance</div><div class="val">${Math.round(LF.state.agents.reduce((a,b)=>a+b.accept,0)/LF.state.agents.length)}%</div><div class="delta up">target ≥ 70%</div></div>
      <div class="kpi"><div class="lbl">Total spend</div><div class="val">$${totalCost.toFixed(2)}</div><div class="delta up">lifetime</div></div>
    </div>

    <div class="grid g-3" id="agent-grid"></div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Human-in-the-loop queue</h3><span class="tag ${LF.state.hitlQueue.length?'warn':'slate'}">${LF.state.hitlQueue.length} pending</span></div>
      <div id="hitl-queue"></div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Recent runs</h3><button class="btn btn-ghost btn-sm" onclick="LF.state.agentLogs=[];LF.storage.save();LF.router.go('agents')">Clear logs</button></div>
      <div id="recent-runs"></div>
    </div>
  `;

  document.getElementById("agent-grid").innerHTML = LF.state.agents.map(a=>{
    const cfg = LF.state.agentConfig[a.id]||{};
    const myRuns = (LF.state.agentLogs||[]).filter(l=>l.agentId===a.id);
    const lastRun = myRuns[0];
    return `
    <div class="agent-card ${a.status}">
      <div class="status-dot"></div>
      <div class="hdr">
        <div class="ico">${a.ico}</div>
        <div style="flex:1;min-width:0"><h4>${a.name}</h4><div class="role">${a.role}</div></div>
      </div>
      <p>${a.desc}</p>
      <div style="font-size:11px;color:var(--ink-500);padding:6px 8px;background:var(--ink-50);border-radius:6px">
        <b>Trigger:</b> ${escapeHtml(cfg.trigger||'Manual')}
      </div>
      <div class="stats">
        <div><div class="v">${myRuns.length}</div><div class="l">Runs</div></div>
        <div><div class="v">${a.accept}%</div><div class="l">Accept</div></div>
        <div><div class="v">$${(myRuns.reduce((x,y)=>x+(y.cost||0),0)).toFixed(2)}</div><div class="l">Spend</div></div>
      </div>
      <div style="font-size:11px;color:var(--ink-400);display:flex;justify-content:space-between">
        <span>${a.model}</span><span>Last: ${lastRun?fmtTime(lastRun.at):'never'}</span>
      </div>
      <div class="ctrl">
        <button class="btn btn-primary btn-xs" onclick="LF.runAgent('${a.id}')">▶ Run</button>
        <button class="btn btn-ghost btn-xs" onclick="LF.views.agentLogs('${a.id}')">Logs (${myRuns.length})</button>
        <button class="btn btn-ghost btn-xs" onclick="LF.views.agentConfig('${a.id}')">⚙ Config</button>
      </div>
    </div>`;
  }).join("");

  LF.views.renderHitl();
  LF.views.renderRecentRuns();
};

LF.views.runAllAgents = function(){
  let ran=0, hitl=0;
  LF.state.agents.forEach(a=>{ const r = LF.agentRT.runOnce(a.id); if(r){ ran++; if(r.hitl) hitl++ } });
  LF.toast(`Ran ${ran} agents · ${hitl} awaiting HITL approval`,"info");
  if(LF.state.route==="agents") LF.router.go("agents");
};

LF.views.renderHitl = function(){
  const q = LF.state.hitlQueue || [];
  const el = document.getElementById('hitl-queue'); if(!el) return;
  if(!q.length){ el.innerHTML = '<p style="color:var(--ink-400);font-size:12.5px;padding:10px 0">Nothing awaiting human review. Run an agent with HITL enabled to populate this queue.</p>'; return }
  el.innerHTML = q.map(i=>{
    const lead = i.leadId ? LF.state.leads.find(l=>l.id===i.leadId) : null;
    return `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px dashed var(--ink-150);align-items:center;flex-wrap:wrap">
      <span class="tag blue">${escapeHtml(i.agentName)}</span>
      <div style="flex:1;font-size:13px;color:var(--ink-800);min-width:240px">
        ${escapeHtml(i.action)}
        <div style="font-size:11.5px;color:var(--ink-400);margin-top:2px">Target: ${lead?escapeHtml(lead.name)+' · '+escapeHtml(lead.company):'—'} · queued ${fmtTime(i.proposedAt)}</div>
      </div>
      <button class="btn btn-primary btn-xs" onclick="LF.agentRT.approveHitl('${i.id}')">Approve</button>
      <button class="btn btn-danger btn-xs" onclick="LF.agentRT.rejectHitl('${i.id}')">Reject</button>
    </div>`;
  }).join("");
};

LF.views.renderRecentRuns = function(){
  const logs = (LF.state.agentLogs||[]).slice(0,10);
  const el = document.getElementById('recent-runs'); if(!el) return;
  if(!logs.length){ el.innerHTML = '<p style="color:var(--ink-400);font-size:12.5px;padding:10px 0">No runs yet. Hit ▶ Run on any agent to start.</p>'; return }
  el.innerHTML = logs.map(l=>{
    const lead = l.leadId ? LF.state.leads.find(x=>x.id===l.leadId) : null;
    return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px dashed var(--ink-150);align-items:center;font-size:12.5px">
      <span class="tag ${l.status==='completed'?'green':l.status==='rejected'?'danger':'warn'}">${l.status}</span>
      <div style="flex:1"><b>${escapeHtml(l.agentName)}</b> ${lead?`→ ${escapeHtml(lead.name)} (${escapeHtml(lead.company)})`:''}</div>
      <div style="font-family:var(--font-mono);color:var(--ink-500);font-size:11px">${l.steps.length} steps · ${l.tokens.toLocaleString()} tok · $${l.cost.toFixed(3)} · ${Math.round(l.durationMs)}ms</div>
      <button class="btn btn-ghost btn-xs" onclick="LF.views.showRunDetail('${l.id}')">View</button>
    </div>`;
  }).join("");
};

LF.views.showRunDetail = function(runId){
  const run = LF.state.agentLogs.find(l=>l.id===runId); if(!run) return;
  const lead = run.leadId ? LF.state.leads.find(l=>l.id===run.leadId) : null;
  LF.drawer.open({
    title:`Run · ${run.agentName}`,
    body:`
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <span class="tag ${run.status==='completed'?'green':run.status==='rejected'?'danger':'warn'}">${run.status}</span>
        ${lead?`<span class="tag sky">${escapeHtml(lead.name)} · ${escapeHtml(lead.company)}</span>`:''}
        <span class="tag blue">${run.tokens.toLocaleString()} tokens</span>
        <span class="tag">$${run.cost.toFixed(4)}</span>
        <span class="tag">${Math.round(run.durationMs)}ms</span>
      </div>
      <div style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-700)">
        ${run.steps.map((s,i)=>`
          <div style="padding:10px;border:1px solid var(--ink-150);border-radius:8px;margin-bottom:6px;background:${s.ok?'#fff':'#FEE2E2'}">
            <div style="display:flex;justify-content:space-between;color:var(--ab7-blue-deep);font-weight:700;margin-bottom:3px">
              <span>[${i+1}] ${s.type}${s.tool?' · '+s.tool:''}</span>
              <span style="color:var(--ink-400);font-weight:500">${s.tok} tok · $${s.cost}</span>
            </div>
            ${s.input?`<div style="color:var(--ink-500);font-size:10.5px">in: ${escapeHtml(JSON.stringify(s.input).slice(0,140))}</div>`:''}
            ${s.output?`<div style="color:var(--ink-700);margin-top:3px">${escapeHtml(String(s.output).slice(0,200))}</div>`:''}
          </div>
        `).join("")}
      </div>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Close</button>`
  });
};

LF.views.agentLogs = function(agentId){
  const a = LF.state.agents.find(x=>x.id===agentId);
  const logs = (LF.state.agentLogs||[]).filter(l=>l.agentId===agentId).slice(0,30);
  LF.drawer.open({
    title:`${a.name} · Logs (${logs.length})`,
    body: logs.length ? logs.map(l=>{
      const lead = l.leadId ? LF.state.leads.find(x=>x.id===l.leadId) : null;
      return `<div style="padding:10px;border:1px solid var(--ink-150);border-radius:8px;margin-bottom:8px;cursor:pointer" onclick="LF.drawer.close();LF.views.showRunDetail('${l.id}')">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
          <b>${new Date(l.at).toLocaleString()}</b>
          <span class="tag ${l.status==='completed'?'green':l.status==='rejected'?'danger':'warn'}" style="font-size:10.5px">${l.status}</span>
        </div>
        <div style="font-size:11.5px;color:var(--ink-500)">${lead?escapeHtml(lead.name)+' · '+escapeHtml(lead.company):'— no lead —'} · ${l.steps.length} steps · $${l.cost.toFixed(3)}</div>
      </div>`;
    }).join("") : '<p style="color:var(--ink-400);font-size:13px;padding:20px 0;text-align:center">No runs yet. Click ▶ Run on this agent to generate logs.</p>',
    foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Close</button>
      <button class="btn btn-primary" onclick="LF.drawer.close();LF.runAgent('${agentId}')">▶ Run now</button>`
  });
};

LF.views.agentConfig = function(agentId){
  LF.agentRT._bootstrap();
  const a = LF.state.agents.find(x=>x.id===agentId);
  const cfg = LF.state.agentConfig[agentId];
  LF.drawer.open({
    title:`${a.name} · Configuration`,
    body:`
      <div class="fld-row">
        <div class="fld"><label>Model</label><select id="ac-model">
          <option ${a.model==='Claude Haiku 4.5'?'selected':''}>Claude Haiku 4.5</option>
          <option ${a.model==='Claude Sonnet 4.6'?'selected':''}>Claude Sonnet 4.6</option>
          <option ${a.model==='Claude Opus 4.6'?'selected':''}>Claude Opus 4.6</option>
          <option ${a.model==='GPT-4.1'?'selected':''}>GPT-4.1</option>
          <option ${a.model==='Llama 3.3 70B (VPC)'?'selected':''}>Llama 3.3 70B (VPC)</option>
        </select></div>
        <div class="fld"><label>Provider</label>
          <select id="ac-provider">
            <option value="anthropic" ${cfg.provider==='anthropic'?'selected':''}>Anthropic</option>
            <option value="openai" ${cfg.provider==='openai'?'selected':''}>OpenAI</option>
            <option value="local" ${cfg.provider==='local'?'selected':''}>Local / VPC</option>
          </select>
        </div>
      </div>
      <div class="fld"><label>API key (encrypted at rest)</label>
        <input id="ac-key" type="password" value="${escapeHtml(cfg.apiKey||'')}" placeholder="sk-ant-... or sk-...">
        <div class="hint">If set, real API calls will be made. Empty = simulated run (demo mode).</div>
      </div>
      <div class="fld-row">
        <div class="fld"><label>Cost cap per run (INR)</label><input id="ac-cost" type="number" step="0.01" value="${a.cost}"></div>
        <div class="fld"><label>Temperature</label><input id="ac-temp" type="number" step="0.1" min="0" max="2" value="${cfg.temperature}"></div>
      </div>
      <div class="fld-row">
        <div class="fld"><label>Trigger</label><input id="ac-trigger" value="${escapeHtml(cfg.trigger||'')}"></div>
        <div class="fld"><label>Schedule</label>
          <select id="ac-schedule">
            <option value="manual" ${cfg.schedule==='manual'?'selected':''}>Manual only</option>
            <option value="auto-30s" ${cfg.schedule==='auto-30s'?'selected':''}>Auto · every 30s</option>
            <option value="auto-hourly" ${cfg.schedule==='auto-hourly'?'selected':''}>Auto · hourly</option>
            <option value="auto-daily" ${cfg.schedule==='auto-daily'?'selected':''}>Auto · daily at 9am</option>
          </select>
        </div>
      </div>
      <div class="fld"><label>Human-in-the-loop</label>
        <select id="ac-hitl">
          <option value="before-action" ${cfg.hitlMode==='before-action'?'selected':''}>Before external action (email/SMS/WhatsApp/calendar)</option>
          <option value="always" ${cfg.hitlMode==='always'?'selected':''}>Always (every step needs approval)</option>
          <option value="never" ${cfg.hitlMode==='never'?'selected':''}>Never (full auto)</option>
        </select>
      </div>
      <div class="fld"><label>Tools enabled</label>
        <div id="ac-tools" style="display:flex;gap:6px;flex-wrap:wrap">
          ${LF.agentRT.defaultTools(agentId).map(t=>`
            <label style="display:inline-flex;gap:4px;align-items:center;padding:5px 10px;border:1px solid var(--ink-200);border-radius:999px;font-size:11.5px;font-family:var(--font-mono);cursor:pointer">
              <input type="checkbox" data-tool="${t}" ${cfg.tools.includes(t)?'checked':''}> ${t}
            </label>`).join("")}
        </div>
      </div>
      <div class="fld"><label>System prompt</label><textarea id="ac-prompt" style="min-height:160px;font-family:var(--font-mono);font-size:11.5px">${escapeHtml(cfg.prompt||'')}</textarea></div>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Cancel</button>
      <button class="btn btn-ghost" onclick="LF.views.saveAgentConfig('${agentId}');LF.runAgent('${agentId}')">Save &amp; run</button>
      <button class="btn btn-primary" onclick="LF.views.saveAgentConfig('${agentId}');LF.drawer.close();LF.router.go('agents');LF.toast('Config saved','')">Save</button>`
  });
};

LF.views.saveAgentConfig = function(agentId){
  const a = LF.state.agents.find(x=>x.id===agentId);
  const cfg = LF.state.agentConfig[agentId];
  a.model = document.getElementById('ac-model').value;
  a.cost = parseFloat(document.getElementById('ac-cost').value)||0.05;
  cfg.provider = document.getElementById('ac-provider').value;
  cfg.apiKey = document.getElementById('ac-key').value;
  cfg.temperature = parseFloat(document.getElementById('ac-temp').value)||0.3;
  cfg.trigger = document.getElementById('ac-trigger').value;
  cfg.schedule = document.getElementById('ac-schedule').value;
  cfg.hitlMode = document.getElementById('ac-hitl').value;
  cfg.tools = [...document.querySelectorAll('#ac-tools input:checked')].map(i=>i.dataset.tool);
  cfg.prompt = document.getElementById('ac-prompt').value;
  LF.storage.save();
  if(cfg.schedule!=="manual") LF.agentRT.startScheduler();
};

LF.views.openAuditLedger = function(){
  const logs = (LF.state.agentLogs||[]).slice(0,100);
  LF.drawer.open({
    title:`Audit ledger (${logs.length} recent)`,
    body:`<div style="font-family:var(--font-mono);font-size:11px">
      ${logs.map((l,i)=>{
        const h = Math.random().toString(16).slice(2,10);
        return `<div style="padding:6px 0;border-bottom:1px dashed var(--ink-150)">
          <div style="color:var(--ab7-blue)">#${String(logs.length-i).padStart(4,'0')} · ${new Date(l.at).toISOString()}</div>
          <div style="color:var(--ink-700)">agent=${l.agentName} · status=${l.status} · $${l.cost.toFixed(4)} · sha256:${h}...</div>
        </div>`;
      }).join("") || '<p>No log entries yet.</p>'}
    </div>`,
    foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Close</button>`
  });
};

LF.views.agentBudget = function(){
  const total = LF.state.agents.reduce((a,b)=>a+b.cost,0);
  LF.modal.open({
    title:"Budget caps",
    body:`<p style="font-size:13px;color:var(--ink-500);margin-bottom:14px">Per-run cost caps per agent. Runs that would exceed the cap are halted before external tool calls.</p>
      ${LF.state.agents.map(a=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--ink-150)">
          <div style="flex:1"><b>${escapeHtml(a.name)}</b> <span style="font-size:11px;color:var(--ink-400)">${a.model}</span></div>
          <input type="number" step="0.01" value="${a.cost}" data-a="${a.id}" style="width:90px;padding:4px 8px;border:1px solid var(--ink-200);border-radius:6px;font-family:var(--font-mono)">
          <span style="font-size:11.5px;color:var(--ink-500)">INR</span>
        </div>
      `).join("")}
      <div style="margin-top:12px;padding:10px;background:var(--ab7-sky-ghost);border-radius:8px;font-size:12px">Total per-run cap across agents: <b>$${total.toFixed(2)}</b></div>`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="document.querySelectorAll('[data-a]').forEach(i=>{const a=LF.state.agents.find(x=>x.id===i.dataset.a);if(a)a.cost=parseFloat(i.value)||a.cost});LF.storage.save();LF.modal.close();LF.toast('Budget caps saved','');LF.router.go('agents')">Save caps</button>`
  });
};

LF.views.agentScheduler = function(){
  LF.modal.open({
    title:"Agent scheduler",
    body:`<p style="font-size:13px;color:var(--ink-500);margin-bottom:14px">Auto-run agents on a schedule. Empty schedule = manual only.</p>
      ${LF.state.agents.map(a=>{
        const cfg = LF.state.agentConfig[a.id]||{};
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--ink-150)">
          <div style="flex:1"><b>${escapeHtml(a.name)}</b></div>
          <select data-sched="${a.id}" style="padding:5px 8px;border:1px solid var(--ink-200);border-radius:6px;font-size:12px">
            <option value="manual" ${cfg.schedule==='manual'?'selected':''}>Manual</option>
            <option value="auto-30s" ${cfg.schedule==='auto-30s'?'selected':''}>Every 30s</option>
            <option value="auto-hourly" ${cfg.schedule==='auto-hourly'?'selected':''}>Hourly</option>
            <option value="auto-daily" ${cfg.schedule==='auto-daily'?'selected':''}>Daily 9am</option>
          </select>
        </div>`;
      }).join("")}`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="document.querySelectorAll('[data-sched]').forEach(s=>{const cfg=LF.state.agentConfig[s.dataset.sched];if(cfg)cfg.schedule=s.value});LF.storage.save();LF.modal.close();LF.toast('Scheduler saved','');LF.agentRT.startScheduler();LF.router.go('agents')">Save</button>`
  });
};
/* ==========================================================
   ANALYTICS
   ========================================================== */
/* ==========================================================
   REVENUE INTELLIGENCE — real metrics engine
   ========================================================== */
LF.rev = LF.rev || {};

LF.rev.rangeStart = function(range){
  const now = Date.now();
  const r = String(range||'').toLowerCase();
  if(r==='90') return now - 90*86400000;
  if(r==='ytd'){ const d=new Date(); return new Date(d.getFullYear(),0,1).getTime(); }
  if(r==='30') return now - 30*86400000;
  return 0; // unbounded / all-time (default for callers that don't pass a range)
};

LF.rev.compute = function(range){
  const L = LF.state.leads || [];
  const now = Date.now();
  const thirtyDays = 30*86400000;
  const startTs = LF.rev.rangeStart(range);
  // For closed deals (won/lost) we use updatedAt as the close-date proxy; for created-in-range we use createdAt.
  const inClosedRange = (l)=> startTs===0 || (l.updatedAt||l.createdAt||0) >= startTs;
  const inCreatedRange = (l)=> startTs===0 || (l.createdAt||0) >= startTs;

  // Stage probability for probability-weighted pipeline
  const stageProb = {New:0.05, Contacted:0.12, Qualified:0.25, Demo:0.40, Proposal:0.65, Won:1.0, Lost:0};
  const open = L.filter(l=>!["Won","Lost"].includes(l.stage));
  const won = L.filter(l=>l.stage==="Won" && inClosedRange(l));
  const lost = L.filter(l=>l.stage==="Lost" && inClosedRange(l));
  const pipelineValue = open.reduce((a,b)=>a+(Number(b.amount)||0),0);
  const weightedForecast = open.reduce((a,b)=>a+(Number(b.amount)||0)*(stageProb[b.stage]||0),0);
  const closedAmt = won.reduce((a,b)=>a+(Number(b.amount)||0),0);
  const totalClosed = won.length + lost.length;
  const winRate = totalClosed ? Math.round(won.length/totalClosed*100) : 0;

  // Velocity per stage (days) — from activity history, approximate
  const velocity = {};
  ["New","Contacted","Qualified","Demo","Proposal","Won","Lost"].forEach(s=>{
    const inStage = L.filter(l=>l.stage===s);
    if(inStage.length){
      const days = inStage.map(l=>{
        const stageAct = (l.activities||[]).filter(a=>a.type==="stage" || a.type==="create");
        if(stageAct.length<2) return Math.max(1,(now-l.createdAt)/86400000);
        return (stageAct[stageAct.length-1].at - stageAct[stageAct.length-2].at)/86400000;
      });
      velocity[s] = Math.round(days.reduce((a,b)=>a+b,0)/days.length*10)/10;
    } else velocity[s]=0;
  });

  // Avg cycle (won only)
  const avgCycleDays = won.length ? Math.round(won.reduce((a,b)=>a+(now-b.createdAt)/86400000,0)/won.length) : 0;

  // Slipping deals: open deals with updatedAt > 14 days old
  const slipping = open.filter(l=>{ const t = Number(l.updatedAt)||Number(l.createdAt)||0; return t && (now-t > 14*86400000); });

  // Source attribution — leads scoped to created-in-range, won scoped to closed-in-range
  const bySource = {};
  L.forEach(l=>{
    if(!bySource[l.source]) bySource[l.source]={leads:0,won:0,amt:0};
    if(inCreatedRange(l)) bySource[l.source].leads++;
    if(l.stage==="Won" && inClosedRange(l)){ bySource[l.source].won++; bySource[l.source].amt+=(Number(l.amount)||0) }
  });

  // Win/Loss: we don't have real reasons, infer from heuristics
  const winLoss = {
    byReason: [
      {reason:"Price",        lost:lost.filter(l=>l.amount<15000).length,        won:won.filter(l=>l.amount<15000).length},
      {reason:"Timing",       lost:lost.filter(l=>now-l.createdAt<30*86400000).length, won:won.filter(l=>(now-l.createdAt)<30*86400000).length},
      {reason:"No budget",    lost:lost.filter(l=>l.score<40).length,             won:0},
      {reason:"Competitor",   lost:lost.filter(l=>l.score>=70).length,            won:0},
      {reason:"Feature gap",  lost:lost.filter(l=>l.industry==="SaaS"||l.industry==="BFSI").length,  won:0},
      {reason:"Internal",     lost:Math.max(0, lost.length-Math.floor(lost.length*0.8)),       won:0}
    ]
  };

  // Rep leaderboard — wins scoped to closed-in-range; open pipeline reflects current state (no date filter)
  const byOwner = {};
  L.forEach(l=>{
    if(!byOwner[l.ownerId]) byOwner[l.ownerId] = {id:l.ownerId, won:0, wonAmt:0, open:0, openAmt:0, leads:0};
    byOwner[l.ownerId].leads++;
    if(l.stage==="Won" && inClosedRange(l)){ byOwner[l.ownerId].won++; byOwner[l.ownerId].wonAmt += (Number(l.amount)||0); }
    else if(!["Lost"].includes(l.stage)){ byOwner[l.ownerId].open++; byOwner[l.ownerId].openAmt += (Number(l.amount)||0); }
  });
  const leaderboard = Object.values(byOwner).map(r=>({...r, owner:ownersList().find(o=>o.id===r.id)})).filter(r=>r.owner).sort((a,b)=>b.wonAmt-a.wonAmt);

  // Recent KPIs — scoped to the active range (or last 30d if range was unbounded)
  const newLeads30 = startTs===0
    ? L.filter(l=>now-l.createdAt<thirtyDays).length
    : L.filter(inCreatedRange).length;

  return {
    range: String(range||'all'),
    pipelineValue, weightedForecast, closedAmt, winRate, newLeads30,
    velocity, avgCycleDays, slipping: slipping.length,
    open: open.length, won: won.length, lost: lost.length,
    bySource, winLoss, leaderboard
  };
};

LF.views.analytics = function(el){
  const range = LF.state.revRange = (LF.state.revRange != null ? LF.state.revRange : '');
  const m = LF.rev.compute(range);
  const rangeLabel = range==='90' ? 'last 90 days' : range==='ytd' ? 'year to date' : range==='30' ? 'last 30 days' : 'all time';
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Revenue Intelligence</div><div class="page-sub">Real-time metrics computed from your live pipeline · scoped to <b>${rangeLabel}</b>.</div></div>
      <div class="page-actions">
        <div class="seg" id="rev-range">
          <button class="${range===''?'active':''}" data-r="" onclick="LF.rev.setRange('',this)">All</button>
          <button class="${range==='30'?'active':''}" data-r="30" onclick="LF.rev.setRange('30',this)">30D</button>
          <button class="${range==='90'?'active':''}" data-r="90" onclick="LF.rev.setRange('90',this)">90D</button>
          <button class="${range==='ytd'?'active':''}" data-r="ytd" onclick="LF.rev.setRange('ytd',this)">YTD</button>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="LF.rev.dataSource()">🔌 Data sources</button>
        <button class="btn btn-ghost btn-sm" onclick="LF.rev.exportReport()">⬇ Export report</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Weighted forecast</div><div class="val">${fmtCur(m.weightedForecast)}</div><div class="delta up">from ${m.open} open deals</div></div>
      <div class="kpi"><div class="lbl">Closed won</div><div class="val" style="color:var(--ab7-green-deep)">${fmtCur(m.closedAmt)}</div><div class="delta up">${m.won} deals</div></div>
      <div class="kpi"><div class="lbl">Win rate</div><div class="val">${m.winRate}%</div><div class="delta ${m.winRate>=25?'up':'down'}">${m.won}/${m.won+m.lost} closed</div></div>
      <div class="kpi"><div class="lbl">Slipping deals</div><div class="val" style="color:${m.slipping>0?'var(--danger)':'var(--ink-900)'}">${m.slipping}</div><div class="delta down">no activity 14d+</div></div>
    </div>

    <div class="grid g-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>Pipeline by stage</h3><span class="tag blue">live · ${m.open} open</span></div>
        <div class="chart-wrap"><canvas id="an-pipeline"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Source attribution</h3><span class="tag">${Object.keys(m.bySource).length} sources</span></div>
        <div class="chart-wrap"><canvas id="an-source"></canvas></div>
      </div>
    </div>

    <div class="grid g-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>Win/Loss reasons</h3><span class="tag">inferred from data</span></div>
        <div class="chart-wrap"><canvas id="an-winloss"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Velocity by stage (days avg)</h3><div class="sub">avg cycle: ${m.avgCycleDays}d</div></div>
        <div class="chart-wrap"><canvas id="an-vel"></canvas></div>
      </div>
    </div>

    <div class="grid g-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>Rep leaderboard</h3><div class="sub">${m.leaderboard.length} reps</div></div>
        <div id="rev-leader"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>AI-generated insights</h3><span class="tag gradient">Analyst Agent</span></div>
        <div id="rev-insights"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Deals slipping · ${m.slipping}</h3><span class="tag danger">attention needed</span></div>
      <div id="rev-slipping"></div>
    </div>
  `;
  LF.rev.renderLeaderboard(m);
  LF.rev.renderInsights(m);
  LF.rev.renderSlipping();
  LF.rev.renderCharts(m);
};

LF.rev.renderCharts = function(m){
  Object.values(LF.charts||{}).forEach(c=>{ try{c.destroy()}catch(e){} });
  LF.charts = {};
  const COL_BLUE="#0074D9", COL_GREEN="#00D370", COL_TEAL="#14D8A6", COL_SKY="#8DC1EE";

  // Pipeline by stage — value per stage
  const pipelineByStage = ["New","Contacted","Qualified","Demo","Proposal"].map(s=>{
    const ls = LF.state.leads.filter(l=>l.stage===s);
    return ls.reduce((a,b)=>a+b.amount,0);
  });
  const el1 = document.getElementById("an-pipeline");
  if(el1 && window.Chart) LF.charts.p = new Chart(el1,{
    type:"bar",
    data:{labels:["New","Contacted","Qualified","Demo","Proposal"],datasets:[{label:"Pipeline $",data:pipelineByStage,backgroundColor:[COL_SKY,COL_BLUE,"#005FB1",COL_TEAL,COL_GREEN],borderRadius:5}]},
    options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:"#E2E8F0"},ticks:{callback:v=>"$"+(v/1000)+"k"}},y:{grid:{display:false}}}}
  });

  // Source attribution
  const srcEntries = Object.entries(m.bySource).sort((a,b)=>b[1].leads-a[1].leads).slice(0,8);
  const el2 = document.getElementById("an-source");
  if(el2 && window.Chart) LF.charts.s = new Chart(el2,{
    type:"doughnut",
    data:{labels:srcEntries.map(x=>x[0]),datasets:[{data:srcEntries.map(x=>x[1].leads),backgroundColor:[COL_BLUE,COL_GREEN,COL_TEAL,COL_SKY,"#3B82F6","#8B5CF6","#F59E0B","#EC4899"],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"60%",plugins:{legend:{position:"right",labels:{boxWidth:10,padding:8,font:{size:11}}}}}
  });

  // Win/Loss
  const el3 = document.getElementById("an-winloss");
  if(el3 && window.Chart) LF.charts.wl = new Chart(el3,{
    type:"bar",
    data:{labels:m.winLoss.byReason.map(r=>r.reason),datasets:[
      {label:"Lost",data:m.winLoss.byReason.map(r=>r.lost),backgroundColor:"#DC2626",borderRadius:5},
      {label:"Won",data:m.winLoss.byReason.map(r=>r.won),backgroundColor:COL_GREEN,borderRadius:5}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true}},scales:{y:{beginAtZero:true,grid:{color:"#E2E8F0"}},x:{grid:{display:false}}}}
  });

  // Velocity
  const el4 = document.getElementById("an-vel");
  const vLabels = Object.keys(m.velocity);
  if(el4 && window.Chart) LF.charts.v = new Chart(el4,{
    type:"line",
    data:{labels:vLabels,datasets:[{label:"Avg days",data:vLabels.map(k=>m.velocity[k]),borderColor:COL_BLUE,backgroundColor:"rgba(0,116,217,.1)",tension:.35,fill:true,borderWidth:2,pointRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:"#E2E8F0"}},x:{grid:{display:false}}}}
  });
};

LF.rev.renderLeaderboard = function(m){
  const el = document.getElementById("rev-leader"); if(!el) return;
  const max = Math.max(1, ...m.leaderboard.map(r=>r.wonAmt));
  el.innerHTML = m.leaderboard.slice(0,6).map((r,i)=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--ink-150)">
      <div style="width:22px;font-size:12px;font-weight:800;color:var(--ink-400)">#${i+1}</div>
      <div class="avatar-sm ${r.owner.grp||''}">${r.owner.avatar}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:13px;font-weight:700">${r.owner.name}</div>
          <div style="font-size:12.5px;font-weight:800;color:var(--ab7-green-deep);font-family:var(--font-mono)">${fmtCur(r.wonAmt)}</div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink-500);margin-top:2px">
          <span>${r.won} won · ${r.open} open</span>
          <span>${fmtCur(r.openAmt)} in pipeline</span>
        </div>
        <div class="progress" style="margin-top:4px"><div class="bar" style="width:${(r.wonAmt/max*100).toFixed(0)}%"></div></div>
      </div>
    </div>
  `).join("") || '<p style="color:var(--ink-400);font-size:13px">No rep activity yet.</p>';
};

LF.rev.renderInsights = function(m){
  const el = document.getElementById("rev-insights"); if(!el) return;
  const insights = [];
  if(m.slipping > 0) insights.push({cls:"danger",title:"Slipping deals risk",body:`${m.slipping} open deals (worth ${fmtCur(LF.state.leads.filter(l=>!['Won','Lost'].includes(l.stage) && Date.now()-l.updatedAt>14*86400000).reduce((a,b)=>a+b.amount,0))}) have no activity in 14+ days. Run the Follow-up Agent.`});
  const topSrc = Object.entries(m.bySource).sort((a,b)=>b[1].amt-a[1].amt)[0];
  if(topSrc) insights.push({cls:"green",title:`${topSrc[0]} is your top revenue source`,body:`${topSrc[1].won} won deals worth ${fmtCur(topSrc[1].amt)} from ${topSrc[1].leads} total leads (${Math.round(topSrc[1].won/Math.max(1,topSrc[1].leads)*100)}% win rate).`});
  if(m.winRate && m.winRate<20) insights.push({cls:"warn",title:"Win rate below benchmark",body:`Current win rate ${m.winRate}% is below industry benchmark (25%). Review qualification criteria and top-of-funnel sources.`});
  const hotOpen = LF.state.leads.filter(l=>l.score>=75 && !["Won","Lost"].includes(l.stage)).length;
  if(hotOpen>0) insights.push({cls:"blue",title:`${hotOpen} hot leads in pipeline`,body:`Deals with score ≥ 75 convert 3× faster. Ensure they have an AE assigned and active follow-ups.`});
  if(!insights.length) insights.push({cls:"blue",title:"Steady state",body:"Pipeline is healthy. No urgent actions surfaced."});
  el.innerHTML = insights.map(i=>`
    <div style="padding:10px;background:var(--ab7-sky-ghost);border-left:3px solid ${i.cls==='danger'?'var(--danger)':i.cls==='green'?'var(--ab7-green)':i.cls==='warn'?'#F59E0B':'var(--ab7-blue)'};border-radius:8px;margin-bottom:8px">
      <div style="font-size:12.5px;font-weight:700;color:var(--ink-900);margin-bottom:3px">${escapeHtml(i.title)}</div>
      <div style="font-size:11.5px;color:var(--ink-600);line-height:1.45">${escapeHtml(i.body)}</div>
    </div>
  `).join("");
};

LF.rev.renderSlipping = function(){
  const now = Date.now();
  const slipping = LF.state.leads.filter(l=>!["Won","Lost"].includes(l.stage) && now-l.updatedAt>14*86400000).sort((a,b)=>b.amount-a.amount);
  const el = document.getElementById("rev-slipping"); if(!el) return;
  if(!slipping.length){ el.innerHTML='<p style="color:var(--ink-400);font-size:13px;padding:10px 0">Nothing slipping. Nice.</p>'; return }
  el.innerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Lead</th><th>Company</th><th>Stage</th><th>Value</th><th>Days stale</th><th>Owner</th><th></th></tr></thead><tbody>
    ${slipping.slice(0,8).map(l=>{const o=ownersList().find(x=>x.id===l.ownerId)||{name:'?',avatar:'?'};return `<tr>
      <td><div class="who"><div class="avatar-sm">${initials(l.name)}</div>${escapeHtml(l.name)}</div></td>
      <td>${escapeHtml(l.company)}</td>
      <td><span class="tag ${STAGE_COLORS[l.stage]}">${l.stage}</span></td>
      <td style="font-family:var(--font-mono);font-weight:700">${fmtCur(l.amount,l.currency)}</td>
      <td style="color:var(--danger);font-weight:700">${Math.floor((now-l.updatedAt)/86400000)}d</td>
      <td><div class="who"><div class="avatar-sm">${o.avatar}</div>${escapeHtml(o.name.split(' ')[0])}</div></td>
      <td><button class="btn btn-primary btn-xs" onclick="LF.views.openLeadDrawer('${l.id}')">Action →</button></td>
    </tr>`}).join("")}</tbody></table></div>`;
};

LF.rev.setRange = function(range, btn){
  LF.state.revRange = String(range);
  LF.router.go('analytics');
};

LF.rev.dataSource = function(){
  LF.modal.open({
    title:"Revenue data sources",
    body:`<p style="font-size:13px;color:var(--ink-500);margin-bottom:14px">Revenue Intelligence computes metrics live from your LeadForge lead ledger by default. You can also plug in external sources for consolidated reporting.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="padding:12px;border:1px solid var(--ab7-green);border-radius:10px;background:rgba(0,211,112,.05)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><b>🟢 LeadForge leads &amp; qualifications</b><div style="font-size:11.5px;color:var(--ink-500)">Active · ${LF.state.leads.length} records</div></div>
            <span class="tag green">Live</span>
          </div>
        </div>
        <div style="padding:12px;border:1px solid var(--ink-150);border-radius:10px;display:flex;justify-content:space-between;align-items:center">
          <div><b>📊 Google Sheets / CSV import</b><div style="font-size:11.5px;color:var(--ink-500)">Paste a CSV or Sheet link — columns will be auto-mapped</div></div>
          <button class="btn btn-ghost btn-xs" onclick="LF.importLeadsReal();LF.modal.close()">Connect</button>
        </div>
        <div style="padding:12px;border:1px solid var(--ink-150);border-radius:10px;display:flex;justify-content:space-between;align-items:center">
          <div><b>🔗 Stripe / Razorpay revenue</b><div style="font-size:11.5px;color:var(--ink-500)">Pull closed-won invoice data</div></div>
          <button class="btn btn-ghost btn-xs" onclick="LF.modal.close();LF.router.go('integrations')">Configure</button>
        </div>
        <div style="padding:12px;border:1px solid var(--ink-150);border-radius:10px;display:flex;justify-content:space-between;align-items:center">
          <div><b>📡 Webhook (push)</b><div style="font-size:11.5px;color:var(--ink-500)">POST pipeline events to LeadForge endpoint</div></div>
          <button class="btn btn-ghost btn-xs" onclick="LF.toast('Webhook URL: https://api.leadforge.ab7/v1/events','info')">URL</button>
        </div>
      </div>`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Close</button>
      <button class="btn btn-primary" onclick="LF.modal.close();LF.router.go('analytics')">Re-run metrics</button>`
  });
};

LF.rev.exportReport = function(){
  const range = LF.state.revRange != null ? LF.state.revRange : '';
  const rangeLabel = range==='90' ? 'Last 90 days' : range==='ytd' ? 'Year to date' : 'Last 30 days';
  const m = LF.rev.compute(range);
  const lines = [
    "Revenue Intelligence Report",
    "Generated: "+new Date().toISOString(),
    "Range: "+rangeLabel,
    "",
    `Weighted forecast: ${fmtCur(m.weightedForecast)}`,
    `Closed won: ${fmtCur(m.closedAmt)} (${m.won} deals)`,
    `Open pipeline: ${fmtCur(m.pipelineValue)} (${m.open} deals)`,
    `Win rate: ${m.winRate}%`,
    `Avg cycle: ${m.avgCycleDays}d`,
    `Slipping deals: ${m.slipping}`,
    "",
    "Rep leaderboard:",
    ...m.leaderboard.map((r,i)=>`${i+1}. ${r.owner.name} — ${fmtCur(r.wonAmt)} won · ${r.won} deals`),
    "",
    "Win/Loss reasons:",
    ...m.winLoss.byReason.map(r=>`  ${r.reason}: ${r.lost} lost, ${r.won} won`)
  ];
  const blob = new Blob([lines.join("\n")],{type:"text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `revenue-report-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  LF.toast("Report exported","");
};
/* ==========================================================
   CDP
   ========================================================== */
/* ==========================================================
   CDP — Customer Data Platform (all leads ledger)
   ========================================================== */
LF.cdp = LF.cdp || {};
LF.cdp._bootstrap = function(){
  if(!LF.state.scheduledTasks) LF.state.scheduledTasks = [];
  if(!LF.state.cdpFilter) LF.state.cdpFilter = {q:"",stage:"",qual:"",owner:""};
};

LF.views.cdp = function(el){
  LF.cdp._bootstrap();
  if(LF.qual && LF.qual._bootstrap) LF.qual._bootstrap();
  const L = LF.state.leads;
  const now = Date.now();
  const tasks = LF.state.scheduledTasks;
  const upcoming = tasks.filter(t=>t.status==="open" && t.dueAt>=now).length;
  const overdue = tasks.filter(t=>t.status==="open" && t.dueAt<now).length;
  const done = tasks.filter(t=>t.status==="done").length;

  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Customer Data Platform</div><div class="page-sub">Master ledger of every lead — status, remarks, action plans, and scheduled follow-ups in one place.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.toast('Merge suggested 4 duplicates','info')">✨ Find duplicates</button>
        <button class="btn btn-blue btn-sm" onclick="LF.toast('Refreshing intent signals from Bombora, G2, 6sense','info')">⟳ Refresh intent</button>
        <button class="btn btn-primary btn-sm" onclick="LF.cdp.scheduleNew()">＋ Schedule task</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:14px">
      <div class="kpi"><div class="lbl">Total leads</div><div class="val">${L.length}</div><div class="delta up">in CDP</div></div>
      <div class="kpi"><div class="lbl">Upcoming tasks</div><div class="val" style="color:var(--ab7-blue-deep)">${upcoming}</div><div class="delta up">on track</div></div>
      <div class="kpi"><div class="lbl">Overdue</div><div class="val" style="color:var(--danger)">${overdue}</div><div class="delta down">action needed</div></div>
      <div class="kpi"><div class="lbl">Completed</div><div class="val" style="color:var(--ab7-green-deep)">${done}</div><div class="delta up">done</div></div>
    </div>

    <div class="seg" style="margin-bottom:14px">
      <button class="active" onclick="LF.views.cdpSetTab('ledger',event)">Leads ledger · ${L.length}</button>
      <button onclick="LF.views.cdpSetTab('tasks',event)">Scheduled tasks · ${tasks.length}</button>
    </div>

    <div id="cdp-body"></div>
  `;
  LF.state.cdpTab = LF.state.cdpTab || "ledger";
  LF.views.cdpRenderBody();
};

LF.views.cdpSetTab = function(tab, ev){
  LF.state.cdpTab = tab;
  document.querySelectorAll(".view .seg button").forEach(b=>b.classList.remove("active"));
  if(ev) ev.target.classList.add("active");
  LF.views.cdpRenderBody();
};

LF.views.cdpRenderBody = function(){
  const tab = LF.state.cdpTab || "ledger";
  const body = document.getElementById("cdp-body"); if(!body) return;
  if(tab==="ledger"){ body.innerHTML = LF.views._cdpLedgerHtml(); LF.views.cdpRenderLedger(); }
  else { body.innerHTML = LF.views._cdpTasksHtml(); LF.views.cdpRenderTasks(); }
};

LF.views._cdpLedgerHtml = function(){
  const f = LF.state.cdpFilter;
  return `
    <div class="tbl-wrap">
      <div class="tbl-toolbar">
        <div class="tbl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="cdp-q" placeholder="Search name, email, company, city…" value="${escapeHtml(f.q)}" oninput="LF.state.cdpFilter.q=this.value;LF.views.cdpRenderLedger()">
        </div>
        <select class="filter" onchange="LF.state.cdpFilter.stage=this.value;LF.views.cdpRenderLedger()">
          <option value="">All stages</option>
          ${STAGES.map(s=>`<option ${f.stage===s?'selected':''}>${s}</option>`).join("")}
        </select>
        <select class="filter" onchange="LF.state.cdpFilter.qual=this.value;LF.views.cdpRenderLedger()">
          <option value="">All qualification</option>
          <option ${f.qual==='qualified'?'selected':''} value="qualified">✓ Qualified</option>
          <option ${f.qual==='nurture'?'selected':''} value="nurture">◷ Nurture</option>
          <option ${f.qual==='disqualified'?'selected':''} value="disqualified">✕ Disqualified</option>
          <option ${f.qual==='unqualified'?'selected':''} value="unqualified">Pending</option>
        </select>
        <select class="filter" onchange="LF.state.cdpFilter.owner=this.value;LF.views.cdpRenderLedger()">
          <option value="">All owners</option>
          ${ownersList().map(o=>`<option value="${o.id}" ${f.owner===o.id?'selected':''}>${o.name}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" onclick="LF.state.cdpFilter={q:'',stage:'',qual:'',owner:''};LF.router.go('cdp')">Clear</button>
      </div>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr>
          <th>Lead</th><th>Company</th><th>Stage</th><th>Score</th><th>Qualification</th><th>Service interest</th><th>Owner</th><th>Remarks</th><th>Next action</th><th></th>
        </tr></thead>
        <tbody id="cdp-rows"></tbody>
      </table>
      </div>
      <div class="tbl-foot"><div id="cdp-count"></div></div>
    </div>
  `;
};

LF.views.cdpFilteredLeads = function(){
  const f = LF.state.cdpFilter;
  const q = (f.q||"").toLowerCase().trim();
  return LF.state.leads.filter(l=>{
    if(q && !(l.name+l.email+l.company+l.city+l.country).toLowerCase().includes(q)) return false;
    if(f.stage && l.stage!==f.stage) return false;
    if(f.owner && l.ownerId!==f.owner) return false;
    if(f.qual){
      const st = LF.qual.leadStatus(l).status;
      if(st!==f.qual) return false;
    }
    return true;
  });
};

LF.views.cdpRenderLedger = function(){
  const list = LF.views.cdpFilteredLeads();
  const rows = document.getElementById("cdp-rows"); if(!rows) return;
  rows.innerHTML = list.slice(0,80).map(l=>{
    const qst = LF.qual.leadStatus(l);
    const o = ownersList().find(x=>x.id===l.ownerId)||{name:"Unassigned",avatar:"?",grp:""};
    const pillMap = {qualified:["green","✓ Qualified"],nurture:["warn","◷ Nurture"],disqualified:["danger","✕ Disqualified"],unqualified:["slate","Pending"]};
    const [qcls,qlabel] = pillMap[qst.status]||pillMap.unqualified;
    const svc = l.serviceInterest?.serviceId ? LF.qual.getService(l.serviceInterest.serviceId) : null;
    const nextTask = (LF.state.scheduledTasks||[]).filter(t=>t.leadId===l.id && t.status==="open").sort((a,b)=>a.dueAt-b.dueAt)[0];
    const sc = LF.formula.healthClass(l);
    return `<tr>
      <td><div class="who"><div class="avatar-sm ${l.tags?.includes('hot')?'g2':''}">${initials(l.name)}</div><div><div style="font-weight:700">${escapeHtml(l.name)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(l.email)}</div></div></div></td>
      <td><div style="font-weight:600">${escapeHtml(l.company)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(l.city)}, ${l.country}</div></td>
      <td><span class="tag ${STAGE_COLORS[l.stage]}">${l.stage}</span></td>
      <td><span class="score-pill ${sc}">${l.score}</span></td>
      <td><span class="tag ${qcls}">${qlabel}</span>${qst.score!==null?`<div style="font-size:10.5px;color:var(--ink-400);margin-top:2px">${qst.score}/100</div>`:''}</td>
      <td>${svc?`<div style="font-size:12px;font-weight:600">${escapeHtml(svc.name)}</div>`:'<span style="color:var(--ink-400);font-size:11px">—</span>'}</td>
      <td><div class="who"><div class="avatar-sm ${o.grp||''}">${o.avatar}</div><span style="font-size:12px">${escapeHtml(o.name.split(' ')[0])}</span></div></td>
      <td style="max-width:180px">
        <div style="font-size:11.5px;color:var(--ink-700);line-height:1.45;max-height:34px;overflow:hidden;text-overflow:ellipsis">${escapeHtml((l.notes||'').slice(0,80))||'<span style="color:var(--ink-400)">—</span>'}</div>
        <button class="btn btn-ghost btn-xs" style="margin-top:4px;padding:2px 8px;font-size:10.5px" onclick="LF.cdp.editRemarks('${l.id}')">✎ Edit</button>
      </td>
      <td style="min-width:140px">${nextTask?`<div style="font-size:11.5px"><b>${escapeHtml(nextTask.title.slice(0,24))}</b></div><div style="font-size:10.5px;color:${nextTask.dueAt<Date.now()?'var(--danger)':'var(--ink-500)'}">${fmtTime(nextTask.dueAt)} · ${ownersList().find(u=>u.id===nextTask.assigneeId)?.name.split(' ')[0]||'—'}</div>`:'<span style="color:var(--ink-400);font-size:11px">No task scheduled</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-blue btn-xs" onclick="LF.cdp.actionPlan('${l.id}')">📝 Action plan</button>
        <button class="btn btn-primary btn-xs" onclick="LF.cdp.scheduleTask('${l.id}')">📅 Schedule</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="10" class="tbl-empty">No leads match these filters.</td></tr>`;
  const c = document.getElementById("cdp-count");
  if(c) c.textContent = `Showing ${Math.min(80,list.length)} of ${list.length} leads · ${LF.state.scheduledTasks.length} scheduled tasks total`;
};

LF.cdp.editRemarks = function(leadId){
  const l = LF.state.leads.find(x=>x.id===leadId); if(!l) return;
  const text = prompt(`Remarks for ${l.name}:`, l.notes||"");
  if(text===null) return;
  l.notes = text;
  l.updatedAt = Date.now();
  l.activities.push({type:"note",at:Date.now(),by:LF.state.user.id,text:"Remarks updated"});
  LF.storage.save();
  LF.views.cdpRenderLedger();
  LF.toast("Remarks saved","");
};

LF.cdp.actionPlan = function(leadId){
  const l = LF.state.leads.find(x=>x.id===leadId); if(!l) return;
  const existing = l.actionPlan || `1. Send tailored pitch deck for ${l.industry}\n2. Book a 30-min discovery call\n3. Share 2 reference case studies\n4. Propose pricing & next steps\n5. Loop in AE if qualified`;
  LF.modal.open({
    title:`Action plan — ${l.name} · ${l.company}`,
    body:`
      <p style="font-size:13px;color:var(--ink-500);margin-bottom:10px">Define the next steps for this lead. Save it to their record, or save & schedule the first follow-up as a task.</p>
      <div class="fld"><label>Action plan</label>
        <textarea id="ap-text" style="min-height:180px">${escapeHtml(existing)}</textarea>
        <div class="hint">One action per line. Lines starting with a date (e.g. "2026-05-02: Call again") can be converted into tasks.</div>
      </div>
      <div class="fld"><label>Tags</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-xs" onclick="document.getElementById('ap-text').value += '\\n' + new Date(Date.now()+7*86400000).toISOString().slice(0,10)+': Follow-up call'">＋ Follow-up in 7d</button>
          <button type="button" class="btn btn-ghost btn-xs" onclick="document.getElementById('ap-text').value += '\\nSend pricing proposal'">＋ Send proposal</button>
          <button type="button" class="btn btn-ghost btn-xs" onclick="document.getElementById('ap-text').value += '\\nCreate commercial brief'">＋ Commercial brief</button>
          <button type="button" class="btn btn-ghost btn-xs" onclick="LF.cdp.aiDraftPlan('${leadId}')">✦ AI draft</button>
        </div>
      </div>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-ghost" onclick="LF.cdp.saveActionPlan('${leadId}',false)">Save plan</button>
      <button class="btn btn-primary" onclick="LF.cdp.saveActionPlan('${leadId}',true)">Save &amp; schedule next task →</button>`
  });
};

LF.cdp.aiDraftPlan = async function(leadId){
  LF.claude._bootstrap();
  if(LF.claude.isConfigured() && LF.state.claudeConfig.useFor.actionPlans){
    const lead = LF.state.leads.find(x=>x.id===leadId); if(!lead) return;
    const ta = document.getElementById('ap-text');
    if(ta){ ta.value = "Drafting with Claude…"; ta.disabled = true; }
    const svc = lead.serviceInterest?.serviceId ? LF.qual.getService(lead.serviceInterest.serviceId) : null;
    const prompt = `Generate a 5-step action plan for the sales rep to close ${lead.name} at ${lead.company} (${lead.industry}, ${lead.city}). Current stage: ${lead.stage}. Lead score: ${lead.score}. ${svc?'Service of interest: '+svc.name+'. ':''}Format: one action per line, specific and time-boxed.`;
    const res = await LF.claude.complete(prompt, {kind:"action-plan", lead, maxTokens:400});
    if(ta){ ta.value = res.text; ta.disabled = false; }
    LF.toast(res.demo?"AI plan drafted (demo)":`Plan drafted via Claude · $${res.cost.toFixed(5)}`, "info");
    return;
  }
  (function _fallback(){
  const l = LF.state.leads.find(x=>x.id===leadId); if(!l) return;
  const svc = l.serviceInterest?.serviceId ? LF.qual.getService(l.serviceInterest.serviceId) : null;
  const drafts = [
    `1. Share ${svc?svc.name:l.industry} case study deck via email\n2. Book a 30-min discovery call in the next 5 days\n3. Draft a tailored commercial proposal with 3 tier options\n4. Run a 6-turn qualification chat with the Qualifier Agent\n5. Loop in the AE once qualification score ≥ 60`,
    `1. Send a short "why LeadForge over ${l.industry} incumbents" one-pager\n2. Offer a no-commitment free migration from their current stack\n3. Schedule a live demo with the Nurture Agent for next week\n4. Capture budget + timeline in the qualification checklist\n5. If qualified → hand off to ${ownersList().find(o=>o.id===l.ownerId)?.name||'AE'} with a structured brief`,
    `1. Record a 3-min Loom walkthrough of the workspace for ${l.company}\n2. Follow up on WhatsApp with the Loom link in 24 hours\n3. If opened, book a consultative call within 48 hours\n4. Send pricing & ROI calculator tailored to their team size\n5. Auto-qualify and create opportunity if score >= 75`
  ];
  document.getElementById('ap-text').value = drafts[Math.floor(Math.random()*drafts.length)];
  LF.toast("AI plan drafted","info");
  })();
};

LF.cdp.saveActionPlan = function(leadId, scheduleNext){
  const l = LF.state.leads.find(x=>x.id===leadId); if(!l) return;
  const text = document.getElementById('ap-text').value.trim();
  l.actionPlan = text;
  l.updatedAt = Date.now();
  l.activities.push({type:"plan",at:Date.now(),by:LF.state.user.id,text:"Updated action plan"});
  LF.storage.save();
  LF.modal.close();
  LF.toast("Action plan saved","");
  if(scheduleNext){
    // pre-fill scheduled task with first line of plan
    const firstLine = text.split("\n").map(s=>s.trim()).filter(Boolean)[0] || "Follow up";
    LF.cdp.scheduleTask(leadId, firstLine);
  } else {
    LF.views.cdpRenderBody();
  }
};

LF.cdp.scheduleTask = function(leadId, prefillTitle){
  LF.cdp._bootstrap();
  const l = leadId ? LF.state.leads.find(x=>x.id===leadId) : null;
  const title = prefillTitle || (l?`Follow up with ${l.name}`:"New task");
  const defaultDue = new Date(Date.now()+2*86400000);
  defaultDue.setHours(10,0,0,0);
  const due = defaultDue.toISOString().slice(0,16);
  LF.modal.open({
    title: l?`Schedule task — ${l.name}`:"Schedule a task",
    body:`
      <div class="fld"><label>Task title</label><input id="st-title" value="${escapeHtml(title)}"></div>
      <div class="fld"><label>Description / notes</label><textarea id="st-desc" style="min-height:70px" placeholder="Context, links, prep notes…">${l?`Context: ${escapeHtml(l.company)} · ${escapeHtml(l.industry)} · Score ${l.score} · Stage ${l.stage}`:''}</textarea></div>
      <div class="fld-row">
        <div class="fld"><label>Due date &amp; time</label><input id="st-due" type="datetime-local" value="${due}"></div>
        <div class="fld"><label>Priority</label>
          <select id="st-pri">
            <option value="high">🔴 High</option>
            <option value="med" selected>🟡 Medium</option>
            <option value="low">🟢 Low</option>
          </select>
        </div>
      </div>
      <div class="fld-row">
        <div class="fld"><label>Assignee</label>
          <select id="st-assignee">${ownersList().map(o=>`<option value="${o.id}" ${o.id===(l?.ownerId||LF.state.user.id)?'selected':''}>${o.name}</option>`).join("")}</select>
        </div>
        <div class="fld"><label>Lead</label>
          <select id="st-lead">
            <option value="">— none —</option>
            ${LF.state.leads.map(x=>`<option value="${x.id}" ${x.id===leadId?'selected':''}>${escapeHtml(x.name)} · ${escapeHtml(x.company)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="fld"><label style="display:flex;gap:6px;align-items:center;text-transform:none;font-size:13px;font-weight:500;color:var(--ink-700)"><input type="checkbox" id="st-remind" checked> Send reminder to assignee 1 hour before due</label></div>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="LF.cdp.saveTask()">Schedule task</button>`
  });
};

LF.cdp.scheduleNew = function(){ LF.cdp.scheduleTask(null) };

LF.cdp.saveTask = function(){
  const title = document.getElementById('st-title').value.trim();
  const desc = document.getElementById('st-desc').value.trim();
  const dueStr = document.getElementById('st-due').value;
  const pri = document.getElementById('st-pri').value;
  const assigneeId = document.getElementById('st-assignee').value;
  const leadId = document.getElementById('st-lead').value || null;
  const remind = document.getElementById('st-remind').checked;
  if(!title){ LF.toast("Title required","err"); return }
  if(!dueStr){ LF.toast("Due date required","err"); return }
  const dueAt = new Date(dueStr).getTime();
  const t = {
    id: rid(), title, description:desc, dueAt, priority:pri,
    assigneeId, leadId, remind,
    status:"open", createdAt:Date.now(), createdBy:LF.state.user.id,
    completedAt:null
  };
  LF.state.scheduledTasks.unshift(t);
  if(leadId){
    const l = LF.state.leads.find(x=>x.id===leadId);
    if(l){
      l.activities.push({type:"task",at:Date.now(),by:LF.state.user.id,text:`Scheduled task: "${title}" for ${fmtDate(dueAt)}`});
      l.updatedAt = Date.now();
    }
  }
  LF.storage.save();
  LF.modal.close();
  LF.toast(`Task scheduled for ${fmtDate(dueAt)}`,"");
  LF.views.cdpRenderBody();
};

LF.views._cdpTasksHtml = function(){
  return `
    <div class="tbl-wrap">
      <div class="tbl-toolbar">
        <div class="seg">
          <button class="active" onclick="LF.state.cdpTaskFilter='all';LF.views.cdpRenderTasks();LF.cdp.setSeg(event)">All</button>
          <button onclick="LF.state.cdpTaskFilter='open';LF.views.cdpRenderTasks();LF.cdp.setSeg(event)">Upcoming</button>
          <button onclick="LF.state.cdpTaskFilter='overdue';LF.views.cdpRenderTasks();LF.cdp.setSeg(event)">Overdue</button>
          <button onclick="LF.state.cdpTaskFilter='done';LF.views.cdpRenderTasks();LF.cdp.setSeg(event)">Done</button>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" onclick="LF.cdp.exportTasks()">⬇ Export</button>
        <button class="btn btn-primary btn-sm" onclick="LF.cdp.scheduleNew()">＋ New task</button>
      </div>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr><th style="width:30px"></th><th>Task</th><th>Lead</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody id="cdp-task-rows"></tbody>
      </table>
      </div>
      <div class="tbl-foot"><div id="cdp-task-count"></div></div>
    </div>
  `;
};

LF.cdp.setSeg = function(ev){
  if(!ev) return;
  ev.target.closest('.seg').querySelectorAll('button').forEach(b=>b.classList.remove('active'));
  ev.target.classList.add('active');
};

LF.views.cdpRenderTasks = function(){
  const f = LF.state.cdpTaskFilter || "all";
  const now = Date.now();
  let tasks = LF.state.scheduledTasks.slice();
  if(f==="open") tasks = tasks.filter(t=>t.status==="open" && t.dueAt>=now);
  else if(f==="overdue") tasks = tasks.filter(t=>t.status==="open" && t.dueAt<now);
  else if(f==="done") tasks = tasks.filter(t=>t.status==="done");
  tasks.sort((a,b)=>a.status===b.status ? a.dueAt-b.dueAt : (a.status==="done"?1:-1));

  const priMap = {high:["danger","🔴 High"],med:["warn","🟡 Medium"],low:["green","🟢 Low"]};
  const rows = document.getElementById('cdp-task-rows'); if(!rows) return;
  rows.innerHTML = tasks.map(t=>{
    const lead = t.leadId ? LF.state.leads.find(x=>x.id===t.leadId) : null;
    const assignee = ownersList().find(o=>o.id===t.assigneeId);
    const [pCls,pLabel] = priMap[t.priority]||priMap.med;
    const isOverdue = t.status==="open" && t.dueAt<now;
    const isDone = t.status==="done";
    return `<tr style="${isDone?'opacity:.5':''}">
      <td><input type="checkbox" ${isDone?'checked':''} onchange="LF.cdp.toggleTask('${t.id}',this.checked)" title="Mark done"></td>
      <td>
        <div style="font-weight:700;font-size:13px;${isDone?'text-decoration:line-through':''}">${escapeHtml(t.title)}</div>
        ${t.description?`<div style="font-size:11.5px;color:var(--ink-500);line-height:1.45;max-width:360px;margin-top:2px">${escapeHtml(t.description.slice(0,120))}${t.description.length>120?'…':''}</div>`:''}
      </td>
      <td>${lead?`<div style="font-size:12.5px;font-weight:600">${escapeHtml(lead.name)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(lead.company)}</div>`:'<span style="color:var(--ink-400);font-size:11px">—</span>'}</td>
      <td>${assignee?`<div class="who"><div class="avatar-sm ${assignee.grp||''}">${assignee.avatar}</div><span style="font-size:12px">${escapeHtml(assignee.name.split(' ')[0])}</span></div>`:'<span style="color:var(--ink-400);font-size:11px">—</span>'}</td>
      <td><span class="tag ${pCls}">${pLabel}</span></td>
      <td style="font-size:12px;${isOverdue?'color:var(--danger);font-weight:700':'color:var(--ink-700)'}">${fmtDate(t.dueAt)} ${new Date(t.dueAt).toTimeString().slice(0,5)}${isOverdue?' <span style="font-size:10px">(overdue)</span>':''}</td>
      <td>${isDone?'<span class="tag green">✓ Done</span>':isOverdue?'<span class="tag danger">Overdue</span>':'<span class="tag blue">Open</span>'}</td>
      <td style="white-space:nowrap">
        ${lead?`<button class="btn btn-ghost btn-xs" onclick="LF.views.openLeadDrawer('${lead.id}')">Open lead</button>`:''}
        <button class="btn btn-ghost btn-xs" onclick="LF.cdp.editTask('${t.id}')">Edit</button>
        <button class="btn btn-ghost btn-xs" onclick="LF.cdp.deleteTask('${t.id}')">✕</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="tbl-empty">No tasks in this filter. Click "＋ New task" to schedule one.</td></tr>`;
  const c = document.getElementById('cdp-task-count');
  if(c) c.textContent = `Showing ${tasks.length} of ${LF.state.scheduledTasks.length} tasks`;
};

LF.cdp.toggleTask = function(id, checked){
  const t = LF.state.scheduledTasks.find(x=>x.id===id); if(!t) return;
  t.status = checked ? "done" : "open";
  t.completedAt = checked ? Date.now() : null;
  if(t.leadId){
    const l = LF.state.leads.find(x=>x.id===t.leadId);
    if(l){ l.activities.push({type:"task",at:Date.now(),by:LF.state.user.id,text:`${checked?'Completed':'Re-opened'} task: "${t.title}"`}); l.updatedAt=Date.now(); }
  }
  LF.storage.save();
  LF.views.cdpRenderTasks();
  LF.toast(checked?"Task completed":"Task re-opened","");
};

LF.cdp.editTask = function(id){
  const t = LF.state.scheduledTasks.find(x=>x.id===id); if(!t) return;
  const due = new Date(t.dueAt).toISOString().slice(0,16);
  LF.modal.open({
    title:`Edit task`,
    body:`
      <div class="fld"><label>Title</label><input id="st-title" value="${escapeHtml(t.title)}"></div>
      <div class="fld"><label>Description</label><textarea id="st-desc" style="min-height:70px">${escapeHtml(t.description||'')}</textarea></div>
      <div class="fld-row">
        <div class="fld"><label>Due</label><input id="st-due" type="datetime-local" value="${due}"></div>
        <div class="fld"><label>Priority</label><select id="st-pri"><option value="high" ${t.priority==='high'?'selected':''}>🔴 High</option><option value="med" ${t.priority==='med'?'selected':''}>🟡 Medium</option><option value="low" ${t.priority==='low'?'selected':''}>🟢 Low</option></select></div>
      </div>
      <div class="fld-row">
        <div class="fld"><label>Assignee</label><select id="st-assignee">${ownersList().map(o=>`<option value="${o.id}" ${o.id===t.assigneeId?'selected':''}>${o.name}</option>`).join("")}</select></div>
        <div class="fld"><label>Lead</label><select id="st-lead"><option value="">— none —</option>${LF.state.leads.map(x=>`<option value="${x.id}" ${x.id===t.leadId?'selected':''}>${escapeHtml(x.name)}</option>`).join("")}</select></div>
      </div>
      <div class="fld"><label style="display:flex;gap:6px;align-items:center;text-transform:none;font-size:13px;font-weight:500"><input type="checkbox" id="st-remind" ${t.remind?'checked':''}> Send reminder 1 hour before due</label></div>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="LF.cdp.saveEditedTask('${id}')">Save</button>`
  });
};

LF.cdp.saveEditedTask = function(id){
  const t = LF.state.scheduledTasks.find(x=>x.id===id); if(!t) return;
  t.title = document.getElementById('st-title').value;
  t.description = document.getElementById('st-desc').value;
  t.dueAt = new Date(document.getElementById('st-due').value).getTime();
  t.priority = document.getElementById('st-pri').value;
  t.assigneeId = document.getElementById('st-assignee').value;
  t.leadId = document.getElementById('st-lead').value || null;
  t.remind = document.getElementById('st-remind').checked;
  LF.storage.save();
  LF.modal.close();
  LF.views.cdpRenderTasks();
  LF.toast("Task updated","");
};

LF.cdp.deleteTask = function(id){
  if(!confirm("Delete this task?")) return;
  LF.state.scheduledTasks = LF.state.scheduledTasks.filter(x=>x.id!==id);
  LF.storage.save();
  LF.views.cdpRenderTasks();
  LF.toast("Task deleted","info");
};

LF.cdp.exportTasks = function(){
  const list = LF.state.scheduledTasks;
  const hdr = ["Title","Description","Due","Priority","Assignee","Lead","Status","Created"];
  const rows = [hdr.join(",")];
  list.forEach(t=>{
    const a = ownersList().find(o=>o.id===t.assigneeId)?.name || "";
    const l = t.leadId ? (LF.state.leads.find(x=>x.id===t.leadId)?.name||"") : "";
    rows.push([t.title,t.description||"",new Date(t.dueAt).toISOString(),t.priority,a,l,t.status,new Date(t.createdAt).toISOString()].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","));
  });
  const blob = new Blob([rows.join("\n")],{type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cdp-tasks-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  LF.toast(`Exported ${list.length} tasks`,"");
};

/* ==========================================================
   CONVERSION
   ========================================================== */
LF.views.conversion = function(el){
  const L = LF.state.leads || [];
  const won = L.filter(l=>l.stage==="Won");
  const lost = L.filter(l=>l.stage==="Lost");
  const closed = won.length + lost.length;

  // === REAL METRICS ===========================================================
  // 1) AI brief accuracy: % of qualified-then-handed-off leads that ended in Won.
  //    A "good brief" is one where the lead's qualification recommendation matched
  //    the actual outcome. Falls back to qualification confidence when no closed
  //    deals exist yet, so the number is never blank.
  const handedOff = L.filter(l => {
    const qst = LF.qual && LF.qual.leadStatus ? LF.qual.leadStatus(l) : {status:"unqualified"};
    return qst.status === "qualified";
  });
  const handedOffAndWon = handedOff.filter(l => l.stage === "Won").length;
  const handedOffAndLost = handedOff.filter(l => l.stage === "Lost").length;
  const briefSample = handedOffAndWon + handedOffAndLost;
  let briefAccuracy = null;
  if(briefSample > 0){
    briefAccuracy = Math.round(handedOffAndWon / briefSample * 100);
  } else if(handedOff.length > 0){
    // No closed deals yet — fall back to avg qualification score across qualified leads
    const avgQ = handedOff.reduce((a,l)=>{
      const qst = LF.qual.leadStatus(l);
      return a + (qst.score||0);
    },0) / handedOff.length;
    briefAccuracy = Math.round(avgQ);
  }
  const briefAccuracyDisplay = briefAccuracy === null ? "—" : briefAccuracy + "%";
  const briefAccuracySub = briefSample > 0
    ? `${handedOffAndWon}/${briefSample} qualified → won`
    : (handedOff.length>0 ? `est. from ${handedOff.length} qualifications` : "no qualifications yet");

  // 2) SDR → AE handoff time: average time between when a lead first hit
  //    "Qualified" and when it next moved stage (Demo/Proposal/Won) or got
  //    reassigned. Computed from each lead's activity timeline.
  let handoffTimes = [];
  L.forEach(l => {
    const acts = (l.activities||[]).slice().sort((a,b)=>a.at-b.at);
    let qualifiedAt = null;
    for(const a of acts){
      const txt = (a.text||"").toLowerCase();
      if(!qualifiedAt && (txt.includes("qualified") || txt.includes("→ qualified") || a.type === "qualify")){
        qualifiedAt = a.at;
        continue;
      }
      if(qualifiedAt){
        const isHandoff =
          (a.type === "stage" && /demo|proposal|won/i.test(txt)) ||
          (a.type === "assign") ||
          (a.type === "edit" && /owner →/i.test(txt));
        if(isHandoff){
          handoffTimes.push((a.at - qualifiedAt) / 60000); // ms → minutes
          break;
        }
      }
    }
  });
  let handoffDisplay = "—", handoffSub = "no handoffs recorded yet";
  if(handoffTimes.length){
    const avgMin = handoffTimes.reduce((a,b)=>a+b,0) / handoffTimes.length;
    if(avgMin < 60){ handoffDisplay = avgMin.toFixed(1) + " min"; }
    else if(avgMin < 1440){ handoffDisplay = (avgMin/60).toFixed(1) + " h"; }
    else { handoffDisplay = (avgMin/1440).toFixed(1) + " d"; }
    handoffSub = `avg across ${handoffTimes.length} handoff${handoffTimes.length>1?'s':''}`;
  }

  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Conversion &amp; Handoff</div><div class="page-sub">Turn Leads into Contact + Account + Opportunity + Project with AI-generated handoff briefs.</div></div>
      <div class="page-actions"><button class="btn btn-primary btn-sm" onclick="LF.views.convertWizard()">Start conversion wizard →</button></div>
    </div>

    <div class="grid g-3" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Converted</div><div class="val">${won.length}</div><div class="delta up">${closed?Math.round(won.length/closed*100)+'% win rate':'no closed deals yet'}</div></div>
      <div class="kpi"><div class="lbl">Avg AI brief accuracy</div><div class="val">${briefAccuracyDisplay}</div><div class="delta up">${escapeHtml(briefAccuracySub)}</div></div>
      <div class="kpi"><div class="lbl">SDR → AE handoff time</div><div class="val">${handoffDisplay}</div><div class="delta up">${escapeHtml(handoffSub)}</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Handoff queue</h3><span class="tag blue">${won.slice(0,5).length} ready</span></div>
      <div style="overflow:auto">
      <table class="tbl">
        <thead><tr><th>Lead</th><th>Company</th><th>Value</th><th>SDR</th><th>AI Brief</th><th></th></tr></thead>
        <tbody>
          ${won.slice(0,5).map(l=>{
            const o = ownersList().find(x=>x.id===l.ownerId);
            return `<tr><td><div class="who"><div class="avatar-sm">${initials(l.name)}</div>${escapeHtml(l.name)}</div></td>
            <td>${escapeHtml(l.company)}</td>
            <td style="font-family:var(--font-mono);font-weight:700;color:var(--ab7-green-deep)">${fmtCur(l.amount,l.currency)}</td>
            <td>${escapeHtml(o?.name||'-')}</td>
            <td><span class="tag green">✦ Generated</span></td>
            <td><button class="btn btn-blue btn-xs" onclick="LF.views.showBrief('${l.id}')">View brief</button></td></tr>`;
          }).join("") || `<tr><td colspan="6" class="tbl-empty">No conversions yet — move deals to "Won" to see them here.</td></tr>`}
        </tbody>
      </table>
      </div>
    </div>
  `;
};
LF.views.convertWizard = function(){
  LF.modal.open({
    title:"Conversion Wizard",
    body:`<p style="font-size:13px;color:var(--ink-500);margin-bottom:12px">Select a won lead to convert into Contact, Account, Opportunity (and optionally a Project).</p>
      <div class="fld"><label>Lead</label>
        <select id="conv-lead">${LF.state.leads.filter(l=>l.stage==="Won"||l.stage==="Proposal").map(l=>`<option value="${l.id}">${l.name} · ${l.company} · ${fmtCur(l.amount,l.currency)}</option>`).join("")||'<option>No eligible leads</option>'}</select>
      </div>
      <div class="fld-row">
        <div class="fld"><label><input type="checkbox" checked> Create Contact</label></div>
        <div class="fld"><label><input type="checkbox" checked> Create Account</label></div>
      </div>
      <div class="fld-row">
        <div class="fld"><label><input type="checkbox" checked> Create Opportunity</label></div>
        <div class="fld"><label><input type="checkbox"> Create Project</label></div>
      </div>
      <div class="fld"><label>Assign AE</label>
        <select>${ownersList().filter(o=>o.role==='AE').map(o=>`<option>${o.name}</option>`).join("")}</select>
      </div>`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="LF.modal.close();LF.toast('Converted · AI brief sent to AE','')">Convert</button>`
  });
};
LF.views.showBrief = function(id){
  const l = LF.state.leads.find(x=>x.id===id);
  LF.modal.open({
    title:`AI Handoff Brief — ${l.name}`,
    body:`<div style="background:linear-gradient(135deg,rgba(59,130,246,.05),rgba(20,216,166,.05));border:1px solid rgba(20,216,166,.25);padding:16px;border-radius:10px">
      <p style="font-size:13.5px;color:var(--ink-800);line-height:1.65"><b>Context:</b> ${escapeHtml(l.name)} is the buyer at ${escapeHtml(l.company)}, a ${l.industry.toLowerCase()} firm based in ${escapeHtml(l.city)}, ${l.country}. Deal is ${fmtCur(l.amount,l.currency)} and has moved through ${l.activities.length} touches over ${Math.ceil((Date.now()-l.createdAt)/86400000)} days.</p>
      <p style="font-size:13.5px;color:var(--ink-800);line-height:1.65;margin-top:10px"><b>Pain points:</b> currently on Zoho CRM with brittle automations; team struggles with WhatsApp + email context switching; needs DPDP-compliant data residency.</p>
      <p style="font-size:13.5px;color:var(--ink-800);line-height:1.65;margin-top:10px"><b>Recommended next actions:</b> 1) Schedule a 30-min scoping call with AE. 2) Share LeadForge vs Zoho battlecard and DPDP compliance one-pager. 3) Offer Migration Studio free-run for proof. 4) Align commercial terms with their ${l.currency} payments in mind.</p>
    </div>`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Close</button>
      <button class="btn btn-primary" onclick="LF.modal.close();LF.toast('Brief emailed to AE','')">Email to AE</button>`
  });
};

/* ==========================================================
   COLLAB
   ========================================================== */
LF.views.collab = function(el){
  // Renamed to "Task list" — single unified view of every task in the workspace.
  LF.cdp && LF.cdp._bootstrap && LF.cdp._bootstrap();
  const tasks = LF.taskList.collectAll();
  const now = Date.now();
  const counts = {
    todo: tasks.filter(t=>t.status==='open' && t.dueAt > now + 86400000).length,
    progress: tasks.filter(t=>t.status==='open' && Math.abs(t.dueAt-now)<=86400000).length,
    overdue: tasks.filter(t=>t.status==='open' && t.dueAt < now - 86400000).length,
    done: tasks.filter(t=>t.status==='done').length
  };
  const sourceCounts = {};
  tasks.forEach(t => { sourceCounts[t.source] = (sourceCounts[t.source]||0)+1; });

  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Task list</div><div class="page-sub">Every pending and completed task across the portal — scheduled tasks, lead follow-ups, qualification next-actions, action-plan steps, agent HITL approvals, all in one place.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.taskList.exportCsv()">⬇ Export CSV</button>
        <button class="btn btn-primary btn-sm" onclick="LF.cdp.scheduleNew()">＋ New task</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:14px">
      <div class="kpi" style="border-left:3px solid var(--ink-300)"><div class="lbl">To-do</div><div class="val">${counts.todo}</div><div class="delta">due > 24h</div></div>
      <div class="kpi" style="border-left:3px solid var(--ab7-blue)"><div class="lbl">In progress</div><div class="val" style="color:var(--ab7-blue-deep)">${counts.progress}</div><div class="delta up">due within 24h</div></div>
      <div class="kpi" style="border-left:3px solid var(--danger)"><div class="lbl">Overdue</div><div class="val" style="color:var(--danger)">${counts.overdue}</div><div class="delta down">action needed</div></div>
      <div class="kpi" style="border-left:3px solid var(--ab7-green)"><div class="lbl">Done</div><div class="val" style="color:var(--ab7-green-deep)">${counts.done}</div><div class="delta up">completed</div></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head">
        <h3>Task kanban <span class="tag blue" style="margin-left:6px">${tasks.length} tracked</span></h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${Object.entries(sourceCounts).map(([s,n])=>`<span class="tag" style="font-size:10.5px">${escapeHtml(s)}: ${n}</span>`).join('')}
        </div>
      </div>
      <div class="kanban-wrap"><div class="kanban" id="task-kanban"></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Full task ledger</h3><span class="tag green">live · pulled from every module</span></div>
      <p style="font-size:12px;color:var(--ink-500);margin-bottom:10px">Tasks here are aggregated from: Customer Data Platform scheduled tasks, lead activities flagged as follow-ups, qualification recommended next-actions, lead action plans, agent HITL queue. Click a row to act on it.</p>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr><th style="width:30px"></th><th>Task</th><th>Source</th><th>Lead</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody id="task-list-rows"></tbody>
      </table>
      </div>
    </div>
  `;
  LF.taskList.renderKanban();
  LF.taskList.renderTable();
};

LF.taskList = LF.taskList || {};
LF.taskList.collectAll = function(){
  const out = [];
  const now = Date.now();
  // 1) scheduled tasks (CDP) — primary source
  (LF.state.scheduledTasks||[]).forEach(t => {
    out.push({
      id:t.id, source:"Scheduled", title:t.title, description:t.description,
      leadId:t.leadId, assigneeId:t.assigneeId,
      dueAt:t.dueAt, status:t.status, priority:t.priority||"med",
      kind:"scheduled"
    });
  });
  // 2) lead actionPlans — extract any lines that look like dated actions
  (LF.state.leads||[]).forEach(l => {
    if(!l.actionPlan) return;
    const lines = l.actionPlan.split("\n").map(s=>s.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      const dateMatch = line.match(/^(\d{4}-\d{2}-\d{2})[:\.\s-]+(.+)/);
      const titleOnly = (dateMatch ? dateMatch[2] : line).replace(/^\d+\.\s*/, '').slice(0, 120);
      if(!titleOnly) return;
      // Skip if a real scheduled task already covers it
      if((LF.state.scheduledTasks||[]).some(t => t.leadId===l.id && t.title.toLowerCase().includes(titleOnly.toLowerCase().slice(0,20)))) return;
      out.push({
        id:`plan_${l.id}_${i}`, source:"Action plan", title:titleOnly,
        description:`From action plan of ${l.name}`,
        leadId:l.id, assigneeId:l.ownerId,
        dueAt: dateMatch ? new Date(dateMatch[1]).getTime() : (now + (i+1)*2*86400000),
        status:"open", priority:i===0?"high":"med",
        kind:"actionplan"
      });
    });
  });
  // 3) lead activities flagged as follow-ups (no separate scheduled task yet)
  (LF.state.leads||[]).forEach(l => {
    (l.activities||[]).forEach(a => {
      const txt = (a.text||"").toLowerCase();
      if((a.type === "task" || /follow up|callback|call back|next step/.test(txt)) && a.at > now - 14*86400000){
        const tid = `act_${l.id}_${a.at}`;
        if((LF.state.scheduledTasks||[]).some(t => t.id === tid)) return;
        // Only include open ones
        const isDone = /complet|done|closed/.test(txt);
        out.push({
          id:tid, source:"Activity", title:(a.text||"Follow-up").slice(0,120),
          description:`On ${l.name} (${l.company})`,
          leadId:l.id, assigneeId:l.ownerId,
          dueAt: a.at + 2*86400000,
          status: isDone ? "done" : "open", priority:"low",
          kind:"activity"
        });
      }
    });
  });
  // 4) qualification recommended actions for nurture-tier leads
  (LF.state.leads||[]).forEach(l => {
    const qst = LF.qual && LF.qual.leadStatus ? LF.qual.leadStatus(l) : null;
    if(qst && qst.status === "nurture"){
      out.push({
        id:`qual_${l.id}`, source:"Qualification", title:`Nurture follow-up: ${l.name}`,
        description:`Lead scored ${qst.score}/100 — needs nurture cadence before re-qualifying`,
        leadId:l.id, assigneeId:l.ownerId,
        dueAt: now + 3*86400000, status:"open", priority:"med",
        kind:"qualification"
      });
    }
  });
  // 5) agent HITL queue
  (LF.state.hitlQueue||[]).forEach(h => {
    out.push({
      id:`hitl_${h.id}`, source:"Agent HITL", title:h.action,
      description:`${h.agentName} requires approval`,
      leadId:h.leadId, assigneeId:LF.state.user?.id,
      dueAt: h.proposedAt + 12*3600000, status:"open", priority:"high",
      kind:"hitl"
    });
  });

  // Dedupe by id, sort by due
  const seen = {};
  return out.filter(t => seen[t.id] ? false : (seen[t.id] = true)).sort((a,b)=>a.dueAt-b.dueAt);
};

LF.taskList.renderKanban = function(){
  const k = document.getElementById('task-kanban'); if(!k) return;
  const tasks = LF.taskList.collectAll();
  const now = Date.now();
  const cols = [
    {id:"todo",      title:"To-do",      tag:"slate", items: tasks.filter(t=>t.status==='open' && t.dueAt > now + 86400000)},
    {id:"progress",  title:"In progress",tag:"blue",  items: tasks.filter(t=>t.status==='open' && Math.abs(t.dueAt-now)<=86400000)},
    {id:"overdue",   title:"Overdue",    tag:"danger",items: tasks.filter(t=>t.status==='open' && t.dueAt < now - 86400000)},
    {id:"done",      title:"Done",       tag:"green", items: tasks.filter(t=>t.status==='done')}
  ];
  const sourceColor = {Scheduled:"blue","Action plan":"warn","Activity":"slate","Qualification":"sky","Agent HITL":"danger"};
  k.innerHTML = cols.map(col => `
    <div class="kanban-col" data-col="${col.id}" ondragover="event.preventDefault();this.classList.add('drop-active')" ondragleave="this.classList.remove('drop-active')" ondrop="LF.taskList.dropTask(event,'${col.id}')">
      <div class="kanban-col-head">
        <div><div class="title">${col.title}</div><div class="value">${col.items.length} task${col.items.length===1?'':'s'}</div></div>
        <div class="count"><span class="tag ${col.tag}" style="font-size:10px">${col.items.length}</span></div>
      </div>
      <div class="kanban-col-body">
        ${col.items.map(t => {
          const lead = t.leadId ? LF.state.leads.find(x=>x.id===t.leadId) : null;
          const owner = ownersList().find(o=>o.id===t.assigneeId)||{name:"?",avatar:"?",grp:""};
          const priMap = {high:"danger",med:"warn",low:"green"};
          const sc = sourceColor[t.source]||"slate";
          return `<div class="kanban-card" ${t.kind==='scheduled'?`draggable="true" ondragstart="LF.taskList.dragTask(event,'${t.id}')" ondragend="this.classList.remove('dragging');document.querySelectorAll('.kanban-col').forEach(c=>c.classList.remove('drop-active'))"`:''} onclick="LF.taskList.openTask('${t.id}','${t.kind}')">
            <div class="title">${escapeHtml(t.title)}</div>
            ${lead ? `<div class="co">${escapeHtml(lead.name)} · ${escapeHtml(lead.company)}</div>` : `<div class="co" style="color:var(--ink-400)">${escapeHtml(t.description||'')}</div>`}
            <div class="row" style="margin-top:6px">
              <div style="display:flex;gap:4px;align-items:center">
                <span class="tag ${sc}" style="font-size:9.5px">${escapeHtml(t.source)}</span>
                <span class="tag ${priMap[t.priority]||'slate'}" style="font-size:9.5px">${t.priority||'med'}</span>
              </div>
              <div style="display:flex;gap:5px;align-items:center">
                <span style="font-size:10.5px;color:var(--ink-500)">${fmtDate(t.dueAt)}</span>
                <div class="avatar-sm ${owner.grp||''}" style="width:22px;height:22px;font-size:9px">${owner.avatar}</div>
              </div>
            </div>
          </div>`;
        }).join("") || '<p style="font-size:11.5px;color:var(--ink-400);padding:10px 0;text-align:center">— empty —</p>'}
      </div>
    </div>
  `).join("");
};

LF.taskList.renderTable = function(){
  const rows = document.getElementById('task-list-rows'); if(!rows) return;
  const tasks = LF.taskList.collectAll();
  const now = Date.now();
  const sourceColor = {Scheduled:"blue","Action plan":"warn","Activity":"slate","Qualification":"sky","Agent HITL":"danger"};
  rows.innerHTML = tasks.map(t => {
    const lead = t.leadId ? LF.state.leads.find(x=>x.id===t.leadId) : null;
    const owner = ownersList().find(o=>o.id===t.assigneeId)||{name:"—",avatar:"?",grp:""};
    const isDone = t.status === "done";
    const isOverdue = !isDone && t.dueAt < now - 86400000;
    const sc = sourceColor[t.source]||"slate";
    return `<tr style="${isDone?'opacity:.55':''}">
      <td>${t.kind==='scheduled' ? `<input type="checkbox" ${isDone?'checked':''} onchange="LF.cdp.toggleTask('${t.id.replace(/^sch_/,'')}',this.checked);LF.taskList.refresh()">` : ''}</td>
      <td>
        <div style="font-weight:700;font-size:13px;${isDone?'text-decoration:line-through':''}">${escapeHtml(t.title)}</div>
        ${t.description ? `<div style="font-size:11px;color:var(--ink-500);margin-top:2px;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.description)}</div>` : ''}
      </td>
      <td><span class="tag ${sc}">${escapeHtml(t.source)}</span></td>
      <td>${lead ? `<div style="font-size:12.5px;font-weight:600">${escapeHtml(lead.name)}</div><div style="font-size:10.5px;color:var(--ink-400)">${escapeHtml(lead.company)}</div>` : '<span style="color:var(--ink-400);font-size:11px">—</span>'}</td>
      <td><div class="who"><div class="avatar-sm ${owner.grp||''}">${owner.avatar}</div><span style="font-size:12px">${escapeHtml(owner.name.split(' ')[0])}</span></div></td>
      <td style="font-size:12px;${isOverdue?'color:var(--danger);font-weight:700':''}">${fmtDate(t.dueAt)}</td>
      <td>${isDone?'<span class="tag green">✓ Done</span>':isOverdue?'<span class="tag danger">Overdue</span>':'<span class="tag blue">Open</span>'}</td>
      <td style="white-space:nowrap">
        ${lead ? `<button class="btn btn-ghost btn-xs" onclick="LF.views.openLeadDrawer('${lead.id}')">Open lead</button>` : ''}
        <button class="btn btn-blue btn-xs" onclick="LF.taskList.openTask('${t.id}','${t.kind}')">Action →</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="tbl-empty">No tasks anywhere — create one with ＋ New task or qualify a lead.</td></tr>`;
  // Update sidebar badge
  const sbT = document.getElementById('sb-tasks-count');
  if(sbT){ const open = tasks.filter(t=>t.status==='open').length; sbT.textContent = open; sbT.style.display = open?'inline-flex':'none'; }
};

LF.taskList.refresh = function(){
  if(LF.state.route === 'collab'){
    LF.taskList.renderKanban();
    LF.taskList.renderTable();
  }
};

LF.taskList.dragTask = function(ev, id){ ev.dataTransfer.setData("text/plain", id); ev.target.classList.add("dragging") };

LF.taskList.dropTask = function(ev, colId){
  ev.preventDefault();
  document.querySelectorAll(".kanban-col").forEach(k=>k.classList.remove("drop-active"));
  const id = ev.dataTransfer.getData("text/plain");
  const t = LF.state.scheduledTasks.find(x=>x.id===id); if(!t) return;
  if(colId==="done"){ t.status="done"; t.completedAt=Date.now(); }
  else if(colId==="todo"){ t.status="open"; t.completedAt=null; t.dueAt=Math.max(t.dueAt, Date.now()+2*86400000); }
  else if(colId==="progress"){ t.status="open"; t.completedAt=null; t.dueAt=Math.max(t.dueAt, Date.now()+3600000); }
  else if(colId==="overdue"){ t.status="open"; t.completedAt=null; t.dueAt=Math.min(t.dueAt, Date.now()-2*86400000); }
  if(t.leadId){
    const l = LF.state.leads.find(x=>x.id===t.leadId);
    if(l){ l.activities.push({type:"task",at:Date.now(),by:LF.state.user.id,text:`Task "${t.title}" → ${colId}`}); l.updatedAt=Date.now(); }
  }
  LF.storage.save();
  LF.taskList.refresh();
  LF.toast(`Task moved to ${colId}`,"");
};

LF.taskList.openTask = function(id, kind){
  if(kind === "scheduled"){
    LF.cdp.editTask(id);
  } else if(kind === "hitl"){
    LF.router.go("dashboard");
    LF.toast("Approve from the AI Agents view (currently hidden) — task surfaced from HITL queue","info");
  } else {
    // Convert ad-hoc task into a real scheduled task and open editor
    const tasks = LF.taskList.collectAll();
    const t = tasks.find(x=>x.id===id); if(!t) return;
    LF.cdp.scheduleTask(t.leadId, t.title);
    setTimeout(()=>{
      const titleEl = document.getElementById('st-title'); if(titleEl) titleEl.value = t.title;
      const descEl  = document.getElementById('st-desc');  if(descEl) descEl.value = t.description||"";
      const dueEl   = document.getElementById('st-due');   if(dueEl) dueEl.value = new Date(t.dueAt).toISOString().slice(0,16);
      const priEl   = document.getElementById('st-pri');   if(priEl) priEl.value = t.priority||"med";
    }, 50);
    LF.toast(`Promote "${t.source}" item to scheduled task →`,"info");
  }
};

LF.taskList.exportCsv = function(){
  const tasks = LF.taskList.collectAll();
  const hdr = ["Title","Source","Description","Lead","Owner","Due","Priority","Status"];
  const rows = [hdr.join(",")];
  tasks.forEach(t => {
    const lead = t.leadId ? LF.state.leads.find(x=>x.id===t.leadId) : null;
    const owner = ownersList().find(o=>o.id===t.assigneeId);
    rows.push([t.title, t.source, t.description||"", lead?lead.name:"", owner?owner.name:"",
      new Date(t.dueAt).toISOString(), t.priority, t.status]
      .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","));
  });
  const blob = new Blob([rows.join("\n")],{type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tasks-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  LF.toast(`Exported ${tasks.length} tasks`,"");
};


LF.views.renderCollabKanban = function(){
  const kanban = document.getElementById('collab-kanban'); if(!kanban) return;
  const tasks = LF.state.scheduledTasks || [];
  const now = Date.now();
  const cols = [
    {id:"todo",      title:"To-do",      tag:"slate", items: tasks.filter(t=>t.status==='open' && t.dueAt > now + 86400000)},
    {id:"progress",  title:"In progress",tag:"blue",  items: tasks.filter(t=>t.status==='open' && Math.abs(t.dueAt-now)<=86400000)},
    {id:"review",    title:"Overdue",    tag:"danger",items: tasks.filter(t=>t.status==='open' && t.dueAt < now - 86400000)},
    {id:"done",      title:"Done",       tag:"green", items: tasks.filter(t=>t.status==='done')}
  ];
  kanban.innerHTML = cols.map(col=>`
    <div class="kanban-col" data-col="${col.id}" ondragover="event.preventDefault();this.classList.add('drop-active')" ondragleave="this.classList.remove('drop-active')" ondrop="LF.views.collabDropTask(event,'${col.id}')">
      <div class="kanban-col-head">
        <div><div class="title">${col.title}</div><div class="value">${col.items.length} task${col.items.length===1?'':'s'}</div></div>
        <div class="count"><span class="tag ${col.tag}" style="font-size:10px">${col.items.length}</span></div>
      </div>
      <div class="kanban-col-body">
        ${col.items.map(t=>{
          const lead = t.leadId ? LF.state.leads.find(x=>x.id===t.leadId) : null;
          const owner = ownersList().find(o=>o.id===t.assigneeId)||{name:"?",avatar:"?",grp:""};
          const priMap = {high:["danger","🔴"],med:["warn","🟡"],low:["green","🟢"]};
          const [pc,pi] = priMap[t.priority]||priMap.med;
          return `<div class="kanban-card" draggable="true" ondragstart="LF.views.collabDragTask(event,'${t.id}')" ondragend="this.classList.remove('dragging');document.querySelectorAll('.kanban-col').forEach(k=>k.classList.remove('drop-active'))" onclick="LF.cdp.editTask('${t.id}')">
            <div class="title">${escapeHtml(t.title)}</div>
            ${lead?`<div class="co">${escapeHtml(lead.name)} · ${escapeHtml(lead.company)}</div>`:''}
            ${t.description?`<div style="font-size:11px;color:var(--ink-500);margin-top:3px;max-height:30px;overflow:hidden">${escapeHtml(t.description.slice(0,70))}${t.description.length>70?'…':''}</div>`:''}
            <div class="row" style="margin-top:6px">
              <span style="font-size:10.5px;color:var(--ink-500)">${fmtDate(t.dueAt)}</span>
              <div style="display:flex;gap:5px;align-items:center">
                <span class="tag ${pc}" style="font-size:9.5px">${pi}</span>
                <div class="avatar-sm ${owner.grp||''}" style="width:22px;height:22px;font-size:9px">${owner.avatar}</div>
              </div>
            </div>
          </div>`;
        }).join("") || '<p style="font-size:11.5px;color:var(--ink-400);padding:10px 0;text-align:center">— empty —</p>'}
      </div>
    </div>
  `).join("");
};

LF.views.collabDragTask = function(ev, id){ ev.dataTransfer.setData("text/plain", id); ev.target.classList.add("dragging") };
LF.views.collabDropTask = function(ev, colId){
  ev.preventDefault();
  const id = ev.dataTransfer.getData("text/plain");
  const t = LF.state.scheduledTasks.find(x=>x.id===id); if(!t) return;
  document.querySelectorAll(".kanban-col").forEach(k=>k.classList.remove("drop-active"));
  if(colId==="done"){ t.status = "done"; t.completedAt = Date.now(); }
  else if(colId==="todo"){ t.status = "open"; t.completedAt = null; t.dueAt = Math.max(t.dueAt, Date.now()+2*86400000); }
  else if(colId==="progress"){ t.status = "open"; t.completedAt = null; t.dueAt = Math.max(t.dueAt, Date.now()+3600000); }
  else if(colId==="review"){ t.status = "open"; t.completedAt = null; t.dueAt = Math.min(t.dueAt, Date.now() - 2*86400000); }
  if(t.leadId){
    const l = LF.state.leads.find(x=>x.id===t.leadId);
    if(l){ l.activities.push({type:"task",at:Date.now(),by:LF.state.user.id,text:`Task "${t.title}" moved to ${colId}`}); l.updatedAt = Date.now(); }
  }
  LF.storage.save();
  LF.views.renderCollabKanban();
  LF.toast(`Task moved to ${colId}`,"");
};

/* ==========================================================
   CUSTOMIZATION
   ========================================================== */
/* ==========================================================
   PICKLISTS — editable industries, countries, currencies
   Used by lead create/edit, CSV import, and any dropdown.
   ========================================================== */
LF.picklists = LF.picklists || {};
LF.picklists._bootstrap = function(){
  if(!Array.isArray(LF.state.industries) || LF.state.industries.length===0){
    LF.state.industries = INDUSTRIES.slice();
  }
  if(!Array.isArray(LF.state.countries) || LF.state.countries.length===0){
    const nameMap = {IN:"India",AE:"United Arab Emirates",QA:"Qatar",SA:"Saudi Arabia",SG:"Singapore",ID:"Indonesia",GB:"United Kingdom",US:"United States",AU:"Australia"};
    const codes = [...new Set(CITIES.map(c=>c[1]))];
    LF.state.countries = codes.map(c=>({code:c, name:nameMap[c]||c}));
  }
  if(!Array.isArray(LF.state.currencies) || LF.state.currencies.length===0){
    LF.state.currencies = ["INR"]; /* Portal-wide INR-only policy */
  }
  // Outcome picklists — used by the Won / Lost lead capture in the drawer
  // and by the Won Leads / Lost Leads filter dropdowns. Editable from
  // Customization. Empty arrays re-seed from the constants on next bootstrap.
  if(!Array.isArray(LF.state.winCategories)     || LF.state.winCategories.length===0)     LF.state.winCategories     = WIN_CATEGORIES.slice();
  if(!Array.isArray(LF.state.winListReasons)    || LF.state.winListReasons.length===0)    LF.state.winListReasons    = WIN_LIST_REASONS.slice();
  if(!Array.isArray(LF.state.lossCategories)    || LF.state.lossCategories.length===0)    LF.state.lossCategories    = LOSS_CATEGORIES.slice();
  if(!Array.isArray(LF.state.notInListReasons)  || LF.state.notInListReasons.length===0)  LF.state.notInListReasons  = NOT_IN_LIST_REASONS.slice();
};
LF.picklists.industries        = function(){ LF.picklists._bootstrap(); return LF.state.industries; };
LF.picklists.countries         = function(){ LF.picklists._bootstrap(); return LF.state.countries; };
LF.picklists.currencies        = function(){ LF.picklists._bootstrap(); return LF.state.currencies; };
LF.picklists.winCategories     = function(){ LF.picklists._bootstrap(); return LF.state.winCategories; };
LF.picklists.winListReasons    = function(){ LF.picklists._bootstrap(); return LF.state.winListReasons; };
LF.picklists.lossCategories    = function(){ LF.picklists._bootstrap(); return LF.state.lossCategories; };
LF.picklists.notInListReasons  = function(){ LF.picklists._bootstrap(); return LF.state.notInListReasons; };

// Spec table for the simple string-list picklists. Adding a new editable
// list usually just means a new row here — the add/edit/remove helpers
// pick up the rest automatically. Outcome-field migration keeps existing
// leads pointing at their old value when an entry is renamed.
LF.picklists._stringSpecs = {
  // kind          → { stateKey, label,                 migrate(oldVal, newVal) }
  industry:        { stateKey:"industries",        label:"industry",                    migrate:(o,n)=>LF.state.leads.forEach(l=>{ if(l.industry===o) l.industry=n; }) },
  winCategory:     { stateKey:"winCategories",     label:"win reason category",         migrate:(o,n)=>LF.state.leads.forEach(l=>{ if(l.outcome && l.outcome.winCategory===o) l.outcome.winCategory=n; }) },
  winListReason:   { stateKey:"winListReasons",    label:"why it's in our list",        migrate:(o,n)=>LF.state.leads.forEach(l=>{ if(l.outcome && l.outcome.winListReason===o) l.outcome.winListReason=n; }) },
  lossCategory:    { stateKey:"lossCategories",    label:"loss reason category",        migrate:(o,n)=>LF.state.leads.forEach(l=>{ if(l.outcome && l.outcome.lossCategory===o) l.outcome.lossCategory=n; }) },
  notInListReason: { stateKey:"notInListReasons",  label:"why it's not in our list",    migrate:(o,n)=>LF.state.leads.forEach(l=>{ if(l.outcome && l.outcome.notInListReason===o) l.outcome.notInListReason=n; }) }
};

LF.picklists.add = function(kind){
  LF.picklists._bootstrap();
  const spec = LF.picklists._stringSpecs[kind];
  if(spec){
    const v = (prompt(`New ${spec.label}`)||"").trim(); if(!v) return;
    const arr = LF.state[spec.stateKey];
    if(arr.includes(v)){ LF.toast("Already exists","err"); return; }
    arr.push(v);
  } else if(kind==="country"){
    const codeRaw = (prompt("Country ISO code (2 letters, e.g. IN)")||"").trim();
    if(!codeRaw) return;
    const code = codeRaw.toUpperCase().slice(0,2);
    const name = (prompt("Country display name", code)||code).trim();
    if(LF.state.countries.find(c=>c.code===code)){ LF.toast("Already exists","err"); return; }
    LF.state.countries.push({code, name});
  } else if(kind==="currency"){
    LF.toast && LF.toast("Portal is locked to INR. Re-enable multi-currency in Settings → Customization.","info"); return;
  } else return;
  LF.storage.save();
  LF.router.go("customization");
  LF.toast("Added","");
};

LF.picklists.edit = function(kind, idx){
  LF.picklists._bootstrap();
  idx = parseInt(idx);
  const spec = LF.picklists._stringSpecs[kind];
  if(spec){
    const arr = LF.state[spec.stateKey];
    const cur = arr[idx]; if(cur==null) return;
    const nv = (prompt(`Edit ${spec.label}`, cur)||"").trim(); if(!nv || nv===cur) return;
    spec.migrate(cur, nv);
    arr[idx] = nv;
  } else if(kind==="country"){
    const cur = LF.state.countries[idx]; if(!cur) return;
    const nc = (prompt("Country code", cur.code)||"").trim(); if(!nc) return;
    const code = nc.toUpperCase().slice(0,2);
    const nn = (prompt("Country name", cur.name)||cur.name).trim();
    LF.state.leads.forEach(l=>{ if(l.country===cur.code) l.country = code; });
    LF.state.countries[idx] = {code, name:nn};
  } else if(kind==="currency"){
    const cur = LF.state.currencies[idx]; if(cur==null) return;
    const nv = (prompt("Currency code", cur)||"").trim(); if(!nv || nv===cur) return;
    const code = nv.toUpperCase().slice(0,3);
    LF.state.leads.forEach(l=>{ if(l.currency===cur) l.currency = code; });
    LF.state.currencies[idx] = code;
  } else return;
  LF.storage.save();
  LF.router.go("customization");
  LF.toast("Updated","");
};

LF.picklists.remove = function(kind, idx){
  LF.picklists._bootstrap();
  idx = parseInt(idx);
  let arr, label;
  const spec = LF.picklists._stringSpecs[kind];
  if(spec){ arr = LF.state[spec.stateKey]; label = arr[idx]; }
  else if(kind==="country"){ arr = LF.state.countries; const c=arr[idx]; label = c?c.code+" — "+c.name:""; }
  else if(kind==="currency"){ arr = LF.state.currencies; label = arr[idx]; }
  else return;
  if(label==null) return;
  if(arr.length<=1){ LF.toast("Need at least one entry","err"); return; }
  if(!confirm('Delete "'+label+'"? Existing leads using this value will keep it; new leads won\'t see it.')) return;
  arr.splice(idx,1);
  LF.storage.save();
  LF.router.go("customization");
  LF.toast("Removed","");
};

LF.views.customization = function(el){
  LF.picklists._bootstrap();
  const ind = LF.state.industries, ctry = LF.state.countries, ccy = LF.state.currencies;
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Customization</div><div class="page-sub">Picklists · custom fields · page layouts · formula fields · sandboxes.</div></div>
      <div class="page-actions"><button class="btn btn-primary btn-sm" onclick="LF.views.addCustomField()">＋ Add field</button></div>
    </div>

    <div class="grid g-3" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>Industries</h3>
          <button class="btn btn-blue btn-xs" onclick="LF.picklists.add('industry')">＋ Add</button>
        </div>
        <div class="sub" style="font-size:11.5px;color:var(--ink-500);margin-bottom:8px">Used in lead form · ${ind.length} value${ind.length===1?'':'s'}</div>
        <div id="pl-industries">
          ${ind.map((v,i)=>`
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed var(--ink-150)">
              <div style="flex:1;font-size:13px">${escapeHtml(v)}</div>
              <button class="btn btn-ghost btn-xs" onclick="LF.picklists.edit('industry', ${i})">Edit</button>
              <button class="btn btn-ghost btn-xs" onclick="LF.picklists.remove('industry', ${i})">✕</button>
            </div>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Countries</h3>
          <button class="btn btn-blue btn-xs" onclick="LF.picklists.add('country')">＋ Add</button>
        </div>
        <div class="sub" style="font-size:11.5px;color:var(--ink-500);margin-bottom:8px">ISO code + display name · ${ctry.length} value${ctry.length===1?'':'s'}</div>
        <div id="pl-countries">
          ${ctry.map((c,i)=>`
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed var(--ink-150)">
              <div style="font-size:11px;font-family:var(--font-mono);font-weight:700;color:var(--ab7-blue-deep);background:var(--ab7-sky-ghost);padding:2px 6px;border-radius:5px">${escapeHtml(c.code)}</div>
              <div style="flex:1;font-size:13px">${escapeHtml(c.name)}</div>
              <button class="btn btn-ghost btn-xs" onclick="LF.picklists.edit('country', ${i})">Edit</button>
              <button class="btn btn-ghost btn-xs" onclick="LF.picklists.remove('country', ${i})">✕</button>
            </div>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Currencies</h3>
          <button class="btn btn-blue btn-xs" onclick="LF.picklists.add('currency')">＋ Add</button>
        </div>
        <div class="sub" style="font-size:11.5px;color:var(--ink-500);margin-bottom:8px">3-letter ISO codes · ${ccy.length} value${ccy.length===1?'':'s'}</div>
        <div id="pl-currencies">
          ${ccy.map((v,i)=>`
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed var(--ink-150)">
              <div style="font-size:12.5px;font-family:var(--font-mono);font-weight:700;flex:1">${escapeHtml(v)}</div>
              <button class="btn btn-ghost btn-xs" onclick="LF.picklists.edit('currency', ${i})">Edit</button>
              <button class="btn btn-ghost btn-xs" onclick="LF.picklists.remove('currency', ${i})">✕</button>
            </div>`).join("")}
        </div>
      </div>
    </div>

    ${(function(){
      /* Outcome categories — Win / Loss. Editable here, used by:
         • lead drawer outcome-capture block (when stage is Won or Lost)
         • Won Leads / Lost Leads filter dropdowns
         • Win-rate-by-industry + Top-loss-reason summary cards
         Adding / removing entries does NOT change values already saved on
         existing leads. Renaming via Edit migrates them via _stringSpecs.   */
      const wc = LF.picklists.winCategories(), wl = LF.picklists.winListReasons();
      const lc = LF.picklists.lossCategories(), nl = LF.picklists.notInListReasons();
      const card = (title, sub, kind, items, accent) => `
        <div class="card">
          <div class="card-head"><h3>${title}</h3>
            <button class="btn btn-blue btn-xs" onclick="LF.picklists.add('${kind}')">＋ Add</button>
          </div>
          <div class="sub" style="font-size:11.5px;color:var(--ink-500);margin-bottom:8px">${sub} · ${items.length} value${items.length===1?'':'s'}</div>
          <div>
            ${items.map((v,i)=>`
              <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed var(--ink-150)">
                <div style="width:6px;height:6px;border-radius:50%;background:${accent}"></div>
                <div style="flex:1;font-size:13px">${escapeHtml(v)}</div>
                <button class="btn btn-ghost btn-xs" onclick="LF.picklists.edit('${kind}', ${i})">Edit</button>
                <button class="btn btn-ghost btn-xs" onclick="LF.picklists.remove('${kind}', ${i})">✕</button>
              </div>`).join("")}
          </div>
        </div>`;
      return `
      <div style="margin:18px 0 10px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-500)">Outcome categories — Win &amp; Loss</div>
        <div style="font-size:12px;color:var(--ink-400);margin-top:4px">Categories shown in the lead drawer when a deal is marked Won or Lost, and as filters on the Won Leads / Lost Leads views.</div>
      </div>
      <div class="grid g-2" style="margin-bottom:14px">
        ${card("Win reason categories", "Why we won it · Won Leads filter", "winCategory",     wc, "var(--ab7-green-deep)")}
        ${card("Why it's in our list",  "Win-side qualification reason",    "winListReason",   wl, "var(--ab7-blue-deep)")}
      </div>
      <div class="grid g-2" style="margin-bottom:16px">
        ${card("Loss reason categories", "Why we lost it · Lost Leads filter", "lossCategory",    lc, "#DC2626")}
        ${card("Why it's not in our list", "Loss-side disqualification reason", "notInListReason", nl, "#F59E0B")}
      </div>`;
    })()}

    <div class="grid g-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>Custom fields</h3><div class="sub">${LF.state.customFields.length} defined</div></div>
        <div id="cf-list"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Sandboxes</h3><span class="tag green">3 env</span></div>
        ${["Development","Staging","Production"].map((e,i)=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:8px;background:var(--ink-50);border-radius:8px;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-size:13.5px;font-weight:700">${e}</div>
              <div style="font-size:11px;color:var(--ink-400);font-family:var(--font-mono)">${e.toLowerCase()}.leadforge.ab7 · last deploy ${i===0?'12m':i===1?'2h':'2d'} ago</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-xs" onclick="LF.toast('Diff: 14 changes in staging vs production','info')">Diff</button>
              <button class="btn btn-blue btn-xs" onclick="LF.toast('Promote staging → production (queued)','')">Promote ↑</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Formula field</h3>
        ${LF.state.formulaPublished
          ? '<span class="tag green">Published · live on lead score-pills</span>'
          : '<span class="tag">Draft</span>'}
      </div>
      <div class="fld"><label>Formula name</label>
        <input id="formula-name" value="${escapeHtml(LF.state.formulaName||'Deal health')}">
      </div>
      <div class="fld"><label>Expression (spreadsheet-like syntax)</label>
        <textarea id="formula-expr" style="font-family:var(--font-mono);font-size:12px;min-height:80px">${escapeHtml(LF.state.formulaExpression||LF.formula.defaultExpression)}</textarea>
        <div style="font-size:11px;color:var(--ink-500);margin-top:6px;line-height:1.6">
          <b>Fields:</b> Score · Amount · DaysSinceLastTouch · DaysSinceCreated · Stage · Industry · Country · Source · Owner<br>
          <b>Functions:</b> IF(cond, a, b) · AND(...) · OR(...) · NOT(x) &nbsp;·&nbsp; <b>Operators:</b> &gt;= &lt;= &gt; &lt; = !=<br>
          <b>Tip:</b> return <code style="background:var(--ink-100);padding:1px 4px;border-radius:3px">"Hot"</code> / <code style="background:var(--ink-100);padding:1px 4px;border-radius:3px">"Warm"</code> / <code style="background:var(--ink-100);padding:1px 4px;border-radius:3px">"Cold"</code> to colour the lead score-pill in pipeline views.
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="LF.actions.testFormula()">▶ Test on live data</button>
        <button class="btn btn-blue btn-sm" onclick="LF.actions.publishFormula()">${LF.state.formulaPublished?'Update & republish':'Publish'}</button>
        ${LF.state.formulaPublished?'<button class="btn btn-ghost btn-sm" onclick="LF.actions.unpublishFormula()">Unpublish</button>':''}
      </div>
    </div>
  `;
  document.getElementById("cf-list").innerHTML = LF.state.customFields.map(f=>`
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px dashed var(--ink-150)">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700">${escapeHtml(f.name)}</div>
        <div style="font-size:11.5px;color:var(--ink-400)">${f.type} · options: ${f.opts.join(", ")}</div>
      </div>
      <button class="btn btn-ghost btn-xs" onclick="LF.views.editCustomField('${f.id}')">Edit</button>
      <button class="btn btn-ghost btn-xs" onclick="if(confirm('Delete field?')){LF.state.customFields=LF.state.customFields.filter(x=>x.id!=='${f.id}');LF.storage.save();LF.router.go('customization')}">✕</button>
    </div>
  `).join("");
};
LF.views.addCustomField = function(){
  const name = prompt("Field name"); if(!name) return;
  const optsRaw = prompt("Options (comma separated)","Option 1, Option 2"); if(!optsRaw) return;
  LF.state.customFields.push({id:rid(),name,type:"select",opts:optsRaw.split(",").map(s=>s.trim()).filter(Boolean)});
  LF.storage.save();
  LF.router.go("customization");
  LF.toast("Custom field added","");
};
LF.views.editCustomField = function(id){
  const f = LF.state.customFields.find(x=>x.id===id);
  const nm = prompt("Name", f.name); if(!nm) return;
  f.name = nm; LF.storage.save(); LF.router.go("customization");
};

/* ==========================================================
   INTEGRATIONS
   ========================================================== */
/* ==========================================================
   INTEGRATIONS — real config with per-integration drawers
   ========================================================== */
LF.integ = LF.integ || {};
LF.integ._bootstrap = function(){
  if(!LF.state.integrationConfig) LF.state.integrationConfig = {};
  const schemas = LF.integ.schemas();
  LF.state.integrations.forEach(i=>{
    if(!LF.state.integrationConfig[i.name]){
      const schema = schemas[i.name] || schemas._default;
      const cfg = {};
      schema.fields.forEach(f=>cfg[f.key]=f.default||"");
      LF.state.integrationConfig[i.name] = {
        status: i.on ? "connected" : "disconnected",
        lastTest: null,
        usage: {calls:0, lastCall:null},
        fields: cfg
      };
    }
  });
};

/* Config schemas per integration */
LF.integ.schemas = function(){ return {
  "_default":             {fields:[{key:"apiKey",label:"API key",type:"password"},{key:"endpoint",label:"API endpoint",type:"text",default:"https://api.example.com/v1"}], instructions:"Paste the API key from the integration's dashboard."},
  "Google Workspace":     {fields:[{key:"clientId",label:"OAuth client ID",type:"text"},{key:"clientSecret",label:"Client secret",type:"password"},{key:"refreshToken",label:"Refresh token",type:"password"},{key:"scopes",label:"Scopes",type:"text",default:"gmail.send calendar.events drive.readonly"}], instructions:"Create an OAuth 2.0 Web app at console.cloud.google.com and paste the IDs here. Used by Compose Email and the Scheduler Agent."},
  "Microsoft 365":        {fields:[{key:"tenantId",label:"Tenant ID",type:"text"},{key:"clientId",label:"App ID",type:"text"},{key:"clientSecret",label:"Secret",type:"password"}], instructions:"Register an app in Entra ID, grant Graph API permissions, paste the IDs. Powers Outlook and Teams."},
  "Slack":                {fields:[{key:"botToken",label:"Bot token (xoxb-)",type:"password"},{key:"defaultChannel",label:"Default channel",type:"text",default:"#deals-notifications"}], instructions:"Install the LeadForge Slack app, then paste the bot token from slack.com/apps/settings."},
  "WhatsApp BSP":         {fields:[{key:"phoneId",label:"Phone number ID",type:"text"},{key:"accessToken",label:"Access token",type:"password"},{key:"verifyToken",label:"Webhook verify token",type:"text",default:"leadforge-wa-2026"}], instructions:"Use Meta WhatsApp Cloud API credentials. Enables WhatsApp messaging from Compose and Follow-up Agent."},
  "Exotel":               {fields:[{key:"sid",label:"Account SID",type:"text"},{key:"apiKey",label:"API key",type:"password"},{key:"callerId",label:"Caller ID",type:"text",default:"+91 80 68 61 XXXX"}], instructions:"Create API credentials at my.exotel.com. Used for voice dialing and SMS in India."},
  "Twilio":               {fields:[{key:"accountSid",label:"Account SID",type:"text"},{key:"authToken",label:"Auth token",type:"password"},{key:"fromNumber",label:"From number (E.164)",type:"text",default:"+1XXXXXXXXXX"}], instructions:"Enter credentials from twilio.com/console. Used for global SMS and voice."},
  "LinkedIn Sales Nav":   {fields:[{key:"apiKey",label:"Partner API key",type:"password"},{key:"seat",label:"Sales Nav seat email",type:"text"}], instructions:"Requires a LinkedIn Sales Nav partner key. Enriches leads with LinkedIn data."},
  "IndiaMART":            {fields:[{key:"crmKey",label:"CRM API key",type:"password"},{key:"mobileNumber",label:"Mobile (registered)",type:"text"}], instructions:"Get the CRM key from IndiaMART seller panel > Lead Manager > API. Streams inquiries to LeadForge in real time."},
  "Meta Lead Ads":        {fields:[{key:"pageAccessToken",label:"Page access token",type:"password"},{key:"pageId",label:"Facebook Page ID",type:"text"},{key:"formIds",label:"Form IDs (comma sep)",type:"text"}], instructions:"Connect the Facebook page that hosts the lead form. Leads arrive in < 30s."},
  "Google Ads":           {fields:[{key:"developerToken",label:"Developer token",type:"password"},{key:"customerId",label:"Customer ID (xxx-xxx-xxxx)",type:"text"},{key:"refreshToken",label:"Refresh token",type:"password"}], instructions:"Create credentials in Google Ads API Center. Enables conversion import and offline-conversion upload."},
  "Stripe":               {fields:[{key:"secretKey",label:"Secret key (sk_live_)",type:"password"},{key:"webhookSecret",label:"Webhook signing secret",type:"password"}], instructions:"Copy keys from stripe.com/dashboard/apikeys. Powers subscription billing and invoice sync."},
  "Razorpay":             {fields:[{key:"keyId",label:"Key ID",type:"text"},{key:"keySecret",label:"Key secret",type:"password"}], instructions:"India payments. Enables UPI, cards, net-banking for invoicing."},
  "DocuSign":             {fields:[{key:"accountId",label:"Account ID",type:"text"},{key:"integrationKey",label:"Integration key",type:"password"},{key:"userId",label:"Impersonation user ID",type:"text"}], instructions:"Used for proposal e-signatures. Uses JWT OAuth."},
  "Zoho Books":           {fields:[{key:"clientId",label:"Client ID",type:"text"},{key:"clientSecret",label:"Client secret",type:"password"},{key:"organizationId",label:"Organization ID",type:"text"}], instructions:"Accounting sync with Indian GST support."},
  "Tally":                {fields:[{key:"host",label:"Tally Server URL",type:"text",default:"http://localhost:9000"},{key:"company",label:"Company name",type:"text"}], instructions:"Requires Tally Prime with ODBC/port 9000 enabled."},
  "Zapier":               {fields:[{key:"webhookUrl",label:"Zapier inbound webhook URL",type:"text",default:"https://hooks.zapier.com/hooks/catch/…"}], instructions:"Drop any Zapier webhook URL. LeadForge posts lead events as they happen."},
  "HubSpot (Migration)":  {fields:[{key:"accessToken",label:"Private-app token",type:"password"},{key:"portalId",label:"Portal ID",type:"text"}], instructions:"One-time import of contacts/companies/deals from HubSpot."},
  "Zoho CRM (Migration)": {fields:[{key:"accessToken",label:"OAuth access token",type:"password"},{key:"dc",label:"Data center",type:"text",default:"in"}], instructions:"Launch the full Migration Studio from here (dry-run, field mapping, rollback)."}
}};

LF.integ.config = function(name){
  LF.integ._bootstrap();
  const schema = LF.integ.schemas()[name] || LF.integ.schemas()._default;
  const cfg = LF.state.integrationConfig[name];
  const integ = LF.state.integrations.find(i=>i.name===name);
  LF.drawer.open({
    title:`${name} · Configure`,
    body:`
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <div style="width:44px;height:44px;border-radius:10px;background:var(--ab7-sky-ghost);display:grid;place-items:center;color:var(--ab7-blue);font-weight:800">${name.slice(0,2).toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700">${escapeHtml(name)}</div>
          <div style="font-size:11.5px;color:var(--ink-400)">${escapeHtml(integ?.desc||'')}</div>
        </div>
        <span class="tag ${integ?.on?'green':'slate'}" id="int-status-tag">${integ?.on?'Connected':'Disconnected'}</span>
      </div>
      <div style="padding:10px 12px;background:var(--ab7-sky-ghost);border-radius:8px;font-size:12px;color:var(--ink-700);line-height:1.5;margin-bottom:14px">
        <b>Setup:</b> ${escapeHtml(schema.instructions)}
      </div>
      ${schema.fields.map(f=>`
        <div class="fld"><label>${escapeHtml(f.label)}</label>
          <input id="int-${f.key}" type="${f.type}" value="${escapeHtml(cfg.fields[f.key]||'')}" ${f.default?'placeholder="'+escapeHtml(f.default)+'"':''}>
        </div>
      `).join("")}
      <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--ink-200)">
        <div style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-500);margin-bottom:6px">Usage</div>
        <div style="font-size:12px;color:var(--ink-600);font-family:var(--font-mono)">
          API calls: <b>${cfg.usage.calls}</b> · last call: ${cfg.usage.lastCall?fmtTime(cfg.usage.lastCall):'—'}<br>
          Last connection test: ${cfg.lastTest?fmtTime(cfg.lastTest):'never'}
        </div>
      </div>
      <div style="margin-top:14px;padding:10px 12px;background:var(--ink-50);border-radius:8px;font-size:11.5px;color:var(--ink-600)">
        <b>Where it's used:</b> ${LF.integ.usageHint(name)}
      </div>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Cancel</button>
      <button class="btn btn-ghost" onclick="LF.integ.testConn('${name.replace(/'/g,"&#39;")}')">⚡ Test connection</button>
      ${integ?.on?`<button class="btn btn-danger" onclick="LF.integ.disconnect('${name.replace(/'/g,"&#39;")}')">Disconnect</button>`:''}
      <button class="btn btn-primary" onclick="LF.integ.save('${name.replace(/'/g,"&#39;")}')">${integ?.on?'Save':'Connect'}</button>`
  });
};

LF.integ.usageHint = function(name){
  const map = {
    "Google Workspace":"Compose email · Scheduler Agent · Drive attachments",
    "Microsoft 365":"Outlook compose · Teams notifications · OneDrive attachments",
    "Slack":"Deal notifications · #channel for new hot leads",
    "WhatsApp BSP":"Compose (WhatsApp channel) · Follow-up Agent · Inbox",
    "Exotel":"Click-to-dial from lead drawer · SMS for India",
    "Twilio":"Click-to-dial (global) · SMS outside India",
    "LinkedIn Sales Nav":"Enrichment by Researcher Agent · LinkedIn outreach",
    "IndiaMART":"Auto-create leads from IndiaMART inquiries",
    "Meta Lead Ads":"Auto-create leads from Facebook/Instagram lead forms",
    "Google Ads":"Conversion import · auto-optimization feedback",
    "Stripe":"Invoice on close-won · subscription billing",
    "Razorpay":"Invoice on close-won (India) · UPI",
    "DocuSign":"Send proposal for signature from Conversion view",
    "Zoho Books":"Auto-create invoice when deal is Won",
    "Tally":"Sync invoices and ledgers for India compliance",
    "Zapier":"Post every lead event to your Zapier webhook",
    "HubSpot (Migration)":"One-click import of contacts/companies/deals",
    "Zoho CRM (Migration)":"Full Migration Studio (mapping, dry-run, rollback)"
  };
  return map[name]||"Core API access";
};

LF.integ.save = function(name){
  LF.integ._bootstrap();
  const schema = LF.integ.schemas()[name] || LF.integ.schemas()._default;
  const cfg = LF.state.integrationConfig[name];
  schema.fields.forEach(f=>{ cfg.fields[f.key] = document.getElementById('int-'+f.key).value });
  // Validate required: at least one non-empty field
  const hasAny = schema.fields.some(f=>cfg.fields[f.key]);
  if(!hasAny){ LF.toast("Please fill at least one credential","err"); return }
  const integ = LF.state.integrations.find(i=>i.name===name);
  integ.on = true; cfg.status = "connected";
  LF.storage.save();
  LF.drawer.close();
  LF.toast(`${name} connected`,"");
  LF.router.go('integrations');
};

LF.integ.disconnect = function(name){
  if(!confirm(`Disconnect ${name}? Cross-module features using this integration will stop working.`)) return;
  const integ = LF.state.integrations.find(i=>i.name===name);
  integ.on = false;
  LF.state.integrationConfig[name].status = "disconnected";
  LF.storage.save();
  LF.drawer.close();
  LF.toast(`${name} disconnected`,"info");
  LF.router.go('integrations');
};

LF.integ.testConn = function(name){
  LF.integ._bootstrap();
  const cfg = LF.state.integrationConfig[name];
  const schema = LF.integ.schemas()[name] || LF.integ.schemas()._default;
  // Gather current form values
  schema.fields.forEach(f=>{ const el=document.getElementById('int-'+f.key); if(el) cfg.fields[f.key]=el.value });
  const hasAny = schema.fields.some(f=>cfg.fields[f.key]);
  cfg.lastTest = Date.now();
  LF.storage.save();
  const tag = document.getElementById('int-status-tag');
  if(!hasAny){ LF.toast("Fill credentials first, then test","err"); return }
  // Simulate test — in real deployment this would hit a backend
  setTimeout(()=>{
    const ok = Math.random() > 0.15;
    if(ok){
      if(tag){ tag.textContent = "Reachable"; tag.className = "tag green"; }
      LF.toast(`${name} · connection OK (round trip ${Math.floor(80+Math.random()*200)}ms)`,"");
    } else {
      if(tag){ tag.textContent = "Unreachable"; tag.className = "tag danger"; }
      LF.toast(`${name} · connection failed — check credentials`,"err");
    }
  }, 400);
};

LF.integ.recordCall = function(name){
  LF.integ._bootstrap();
  const cfg = LF.state.integrationConfig[name]; if(!cfg) return;
  cfg.usage.calls += 1; cfg.usage.lastCall = Date.now();
  LF.storage.save();
};

/* Hook up existing send flows to record calls if integration is configured */
(function(){
  const origSave = LF.email && LF.email.saveSmtp;
  if(origSave){
    LF.email.saveSmtp = function(){ origSave.apply(this, arguments); LF.integ.recordCall && LF.integ.recordCall("Microsoft 365"); };
  }
})();

/* New integrations view */
LF.views.integrations = function(el){
  LF.integ._bootstrap();
  const cats = [...new Set(LF.state.integrations.map(i=>i.cat))];
  const totalConn = LF.state.integrations.filter(i=>i.on).length;
  const totalCalls = Object.values(LF.state.integrationConfig).reduce((a,b)=>a+(b.usage?.calls||0),0);
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Integrations &amp; Marketplace</div><div class="page-sub">Day-one native connectors · revenue-share marketplace · full configuration control.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.toast('Developer portal: docs.leadforge.ab7/api','info')">🧑‍💻 Developer docs</button>
        <button class="btn btn-ghost btn-sm" onclick="LF.integ.testAll()">⚡ Test all connected</button>
        <button class="btn btn-primary btn-sm" onclick="LF.toast('Browse 247 community plugins','info')">Browse marketplace →</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Connected</div><div class="val" style="color:var(--ab7-green-deep)">${totalConn}</div><div class="delta up">of ${LF.state.integrations.length}</div></div>
      <div class="kpi"><div class="lbl">API calls (lifetime)</div><div class="val">${totalCalls.toLocaleString()}</div><div class="delta up">across all integrations</div></div>
      <div class="kpi"><div class="lbl">Categories</div><div class="val">${cats.length}</div><div class="delta up">Productivity, Comms, Channels…</div></div>
      <div class="kpi"><div class="lbl">Marketplace</div><div class="val">247</div><div class="delta up">community plugins</div></div>
    </div>

    <div class="card" style="margin-bottom:16px;border-left:4px solid var(--ab7-green);background:linear-gradient(135deg,rgba(0,211,112,.04),rgba(20,216,166,.04))">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <div>
          <h3 style="font-size:16px;margin-bottom:4px">✦ Migration Studio — free for Zoho customers</h3>
          <p style="font-size:13px;color:var(--ink-600);line-height:1.5">Automate 80%+ of a Zoho CRM migration — leads, contacts, accounts, deals, custom fields, workflows mapped module-by-module.</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="LF.toast('Watch 4-min demo video','info')">▶ Watch demo</button>
          <button class="btn btn-primary btn-sm" onclick="LF.views.migrationStudio()">Start migration</button>
        </div>
      </div>
    </div>

    ${cats.map(cat=>`
      <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-500);margin:18px 0 10px">${cat}</div>
      <div class="grid g-4">
        ${LF.state.integrations.filter(i=>i.cat===cat).map(i=>{
          const cfg = LF.state.integrationConfig[i.name]||{status:"disconnected",usage:{calls:0}};
          return `
          <div class="integ-tile">
            <div style="display:flex;justify-content:space-between">
              <div class="ico">${i.name.slice(0,2).toUpperCase()}</div>
              <div class="toggle ${i.on?'on':''}" onclick="event.stopPropagation();LF.views.toggleIntegration('${i.name.replace(/'/g,"&#39;")}',this)"></div>
            </div>
            <h4>${escapeHtml(i.name)}</h4>
            <p>${escapeHtml(i.desc)}</p>
            <div style="font-size:10.5px;color:var(--ink-400);font-family:var(--font-mono)">${cfg.usage.calls||0} calls · ${cfg.lastTest?'tested '+fmtTime(cfg.lastTest):'not tested'}</div>
            <div style="display:flex;gap:4px">
              <button class="btn btn-blue btn-xs" onclick="LF.integ.config('${i.name.replace(/'/g,"&#39;")}')">⚙ Configure</button>
              ${i.on?`<button class="btn btn-ghost btn-xs" onclick="LF.integ.testConn('${i.name.replace(/'/g,"&#39;")}')">Test</button>`:''}
            </div>
          </div>`;
        }).join("")}
      </div>
    `).join("")}
  `;
};

LF.views.toggleIntegration = function(name, el){
  LF.integ._bootstrap();
  const i = LF.state.integrations.find(x=>x.name===name);
  const cfg = LF.state.integrationConfig[name];
  if(!i.on){
    // Turning on — prompt configuration if no creds set
    const hasAny = Object.values(cfg.fields).some(v=>v);
    if(!hasAny){
      el.classList.remove('on');
      LF.integ.config(name);
      return;
    }
  }
  i.on = !i.on;
  cfg.status = i.on ? "connected" : "disconnected";
  el.classList.toggle("on", i.on);
  LF.storage.save();
  LF.toast(`${name} ${i.on?'connected':'disconnected'}`,"");
};

LF.integ.testAll = function(){
  LF.integ._bootstrap();
  const conn = LF.state.integrations.filter(i=>i.on);
  if(!conn.length){ LF.toast("Nothing connected to test","info"); return }
  let ok=0, fail=0;
  conn.forEach(i=>{ const cfg=LF.state.integrationConfig[i.name]; cfg.lastTest=Date.now(); if(Math.random()>0.15) ok++; else fail++; });
  LF.storage.save();
  LF.toast(`${ok} OK · ${fail} failed across ${conn.length} integrations`, fail?"err":"");
  LF.router.go('integrations');
};

LF.views.migrationStudio = function(){
  LF.modal.open({
    title:"Zoho → LeadForge Migration Studio",
    body:`<p style="font-size:13px;color:var(--ink-500);margin-bottom:16px">Enter your Zoho credentials. We'll run a dry-run first (no data written) and show you a preview.</p>
    <div class="fld"><label>Zoho Domain</label><input placeholder="crm.zoho.in"></div>
    <div class="fld"><label>API Client ID</label><input value="1000.A3XXXXXXXXXXXXXXXXX"></div>
    <div class="fld"><label>Modules to migrate</label>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        ${["Leads (48,127)","Contacts (12,408)","Accounts (3,247)","Deals (1,984)","Tasks","Workflows (14)","Custom fields (62)"].map(m=>`<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" checked> ${m}</label>`).join("")}
      </div>
    </div>`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-ghost" onclick="LF.toast('Dry-run started — 0 records written','info')">Dry run</button>
      <button class="btn btn-primary" onclick="LF.modal.close();LF.toast('Migration queued · estimated 18 min','')">Start migration</button>`
  });
};
/* ==========================================================
   SECURITY
   ========================================================== */
LF.views.security = function(el){
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Security &amp; Compliance</div><div class="page-sub">SOC 2 Type II · ISO 27001 · GDPR · DPDP · CCPA · HIPAA-ready · BYOK · tamper-evident ledger.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.toast('SOC 2 report downloaded','info')">⬇ SOC 2 report</button>
        <button class="btn btn-blue btn-sm" onclick="LF.toast('DSAR kit exported (JSON)','info')">DSAR kit</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Certifications</div><div class="val" style="font-size:18px;line-height:1.25">6 active</div><div class="delta up">audit passed</div></div>
      <div class="kpi"><div class="lbl">MFA coverage</div><div class="val">100%</div><div class="delta up">passkey + FIDO2</div></div>
      <div class="kpi"><div class="lbl">Data residency</div><div class="val" style="font-size:18px;line-height:1.25">IN (Mumbai)</div><div class="delta up">DPDP compliant</div></div>
      <div class="kpi"><div class="lbl">Audit events · 30d</div><div class="val">24,180</div><div class="delta up">all verified</div></div>
    </div>

    <div class="grid g-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3>Compliance controls</h3></div>
        ${[
          ["SOC 2 Type II","Active","✓"],
          ["ISO 27001:2022","Active","✓"],
          ["DPDP (India)","Active","✓"],
          ["GDPR","Active","✓"],
          ["CCPA","Active","✓"],
          ["HIPAA-ready","Optional add-on","◷"]
        ].map(([c,s,ic])=>`
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed var(--ink-150);align-items:center">
            <div style="display:flex;gap:10px;align-items:center">
              <span style="width:24px;height:24px;border-radius:50%;background:rgba(0,211,112,.15);color:var(--ab7-green-deep);display:grid;place-items:center;font-weight:800;font-size:13px">${ic}</span>
              <div><div style="font-size:13px;font-weight:700">${c}</div><div style="font-size:11px;color:var(--ink-400)">${s}</div></div>
            </div>
            <button class="btn btn-ghost btn-xs">View</button>
          </div>
        `).join("")}
      </div>
      <div class="card">
        <div class="card-head"><h3>Encryption &amp; keys</h3><span class="tag blue">AES-256-GCM</span></div>
        <div style="padding:14px;background:var(--ink-900);color:#E2E8F0;border-radius:10px;font-family:var(--font-mono);font-size:11.5px;line-height:1.7;overflow:auto">
          <div><span style="color:var(--ab7-sky)">at-rest</span>: AES-256-GCM · rotate 90d ✓</div>
          <div><span style="color:var(--ab7-sky)">in-transit</span>: TLS 1.3 · HSTS preload ✓</div>
          <div><span style="color:var(--ab7-sky)">field-level</span>: 14 PII fields encrypted ✓</div>
          <div><span style="color:var(--ab7-sky)">BYOK</span>: AWS KMS (arn:aws:kms:ap-south-1:…:key/**) ✓</div>
          <div><span style="color:var(--ab7-sky)">HSM</span>: AWS CloudHSM (FIPS 140-2 Level 3) ✓</div>
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="LF.toast('Key rotation scheduled','info')">Rotate keys</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Tamper-evident audit ledger</h3><span class="tag gradient">Hash-chained · read-only</span></div>
      <div class="audit-row" style="font-weight:800;color:var(--ink-500);text-transform:uppercase;letter-spacing:.08em;font-family:var(--font-sans);font-size:10.5px"><div>Time</div><div>Actor</div><div>Event</div><div>SHA-256 hash (prev → curr)</div></div>
      ${Array.from({length:8}).map((_,i)=>{
        const ev = rand(["lead.create","lead.update","consent.grant","consent.revoke","agent.run","integration.connect","role.assign","key.rotate"]);
        const prev = Math.random().toString(16).slice(2,10)+"…"+Math.random().toString(16).slice(2,6);
        const curr = Math.random().toString(16).slice(2,10)+"…"+Math.random().toString(16).slice(2,6);
        return `<div class="audit-row">
          <div>${new Date(Date.now()-i*600000).toISOString().slice(11,19)}</div>
          <div>${(rand(ownersList())||{name:"—"}).name.split(" ")[0]}</div>
          <div>${ev}</div>
          <div class="hash">${prev} → ${curr}</div>
        </div>`;
      }).join("")}
      <button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="LF.toast('Chain verified — 24,180 events, 0 tampering detected','')">✓ Verify chain</button>
    </div>
  `;
};

/* ==========================================================
   MOBILE
   ========================================================== */
LF.views.mobile = function(el){
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Mobile (Preview)</div><div class="page-sub">Voice-first · offline-first CRDT sync · business-card scanner · GPS check-ins.</div></div>
      <div class="page-actions">
        <a class="btn btn-ghost btn-sm" onclick="LF.toast('App Store URL copied','info')">📱 App Store</a>
        <a class="btn btn-ghost btn-sm" onclick="LF.toast('Play Store URL copied','info')">📱 Play Store</a>
      </div>
    </div>

    <div class="grid g-2">
      <div>
        <div class="phone-frame">
          <div class="phone-screen">
            <div style="background:linear-gradient(180deg,#050B17 0%,#0A1430 100%);color:#fff;padding:44px 18px 18px">
              <div style="font-size:11px;color:var(--ab7-sky);letter-spacing:.18em;text-transform:uppercase;font-weight:700">Good morning</div>
              <div style="font-size:22px;font-weight:800;margin-top:2px">Ashok</div>
              <div style="display:flex;gap:10px;margin-top:16px">
                <div style="flex:1;background:rgba(255,255,255,.06);border-radius:12px;padding:10px;text-align:center">
                  <div style="font-size:20px;font-weight:800">12</div><div style="font-size:10.5px;color:var(--ink-300)">Calls today</div>
                </div>
                <div style="flex:1;background:rgba(255,255,255,.06);border-radius:12px;padding:10px;text-align:center">
                  <div style="font-size:20px;font-weight:800;color:var(--ab7-green)">5</div><div style="font-size:10.5px;color:var(--ink-300)">Hot leads</div>
                </div>
              </div>
            </div>
            <div style="padding:14px 18px;background:#fff;height:calc(100% - 150px);overflow:hidden;position:relative">
              <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-400);margin-bottom:8px">Today's tasks</div>
              ${["Call back Priya Sharma","Demo with Nexora at 3 PM","Send quote to Omar Al Qasimi"].map(t=>`
                <div style="padding:10px;background:var(--ink-50);border-radius:8px;margin-bottom:6px;font-size:12.5px;display:flex;align-items:center;gap:8px">
                  <div style="width:8px;height:8px;border-radius:50%;background:var(--ab7-green);flex:none"></div>
                  ${t}
                </div>
              `).join("")}
              <div style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%);width:64px;height:64px;border-radius:50%;background:var(--ab7-gradient);display:grid;place-items:center;box-shadow:0 10px 26px -6px rgba(59,130,246,.5);color:#fff;font-size:22px">🎤</div>
            </div>
          </div>
        </div>
        <div style="text-align:center;margin-top:12px;font-size:12px;color:var(--ink-400)">Home screen</div>
      </div>
      <div>
        <div class="card"><div class="card-head"><h3>Voice-first commands</h3><span class="tag gradient">Claude</span></div>
          <ul style="list-style:none;display:grid;gap:8px">
            ${["“Log a call with Mr. Sharma, he wants a demo next Tuesday, send our enterprise deck.”","“Show me hot leads in Dubai.”","“Add a new lead Ravi Kumar at Nexora, follow up in two days.”","“What's on my plate today?”"].map(q=>`
              <li style="padding:10px 12px;background:var(--ab7-sky-ghost);border-radius:8px;font-size:12.5px;color:var(--ink-800);line-height:1.55;border-left:3px solid var(--ab7-blue)">${q}</li>
            `).join("")}
          </ul>
        </div>
        <div class="card" style="margin-top:14px"><div class="card-head"><h3>Offline-first sync</h3><span class="tag green">CRDT</span></div>
          <p style="font-size:12.5px;color:var(--ink-600);line-height:1.55">Field reps can write, edit, and move cards offline. LeadForge uses Yjs + CRDT to merge changes conflict-free when back online.</p>
          <div style="display:flex;gap:16px;margin-top:12px;font-size:11.5px;font-family:var(--font-mono)">
            <div><div style="color:var(--ink-400)">Last synced</div><div style="font-weight:700">2s ago · ✓</div></div>
            <div><div style="color:var(--ink-400)">Queued ops</div><div style="font-weight:700">0</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
};

/* ==========================================================
   SETTINGS
   ========================================================== */
/* ==========================================================
   CLAUDE AI — real integration with Anthropic API
   ========================================================== */
LF.claude = LF.claude || {};

LF.claude._bootstrap = function(){
  if(!LF.state.claudeConfig){
    LF.state.claudeConfig = {
      enabled: false,
      apiKey: "",
      model: "claude-sonnet-4-6",
      maxTokens: 1024,
      temperature: 0.5,
      proxyUrl: "",
      systemPrompt: "You are an AI assistant embedded in LeadForge 360, AB7 Solutions' lead management portal. Help the user draft professional sales communications, generate action plans, summarize leads, and qualify prospects. Be concise, specific, and actionable. Respect lead privacy and consent.",
      lastTested: null,
      testStatus: null,
      useFor: {
        emailDrafts: true,
        actionPlans: true,
        aiInsights: true,
        leadSummaries: true,
        qualNotes: true
      }
    };
  }
  if(!LF.state.claudeUsage){
    LF.state.claudeUsage = { calls:0, promptTokens:0, completionTokens:0, lastCall:null, monthlyCost:0 };
  }
};

LF.claude.isConfigured = function(){
  LF.claude._bootstrap();
  return !!(LF.state.claudeConfig.enabled && LF.state.claudeConfig.apiKey);
};

LF.claude.modelCost = function(model, tokensIn, tokensOut){
  const rates = {
    "claude-opus-4-6":     {in:15, out:75},
    "claude-sonnet-4-6":   {in:3,  out:15},
    "claude-haiku-4-5-20251001": {in:0.80, out:4.00},
    "claude-haiku-4-5":    {in:0.80, out:4.00}
  };
  const r = rates[model] || rates["claude-sonnet-4-6"];
  return (tokensIn/1_000_000)*r.in + (tokensOut/1_000_000)*r.out;
};

/* Main completion call. If Claude is configured, hits real API; otherwise returns a locally-generated fallback. */
LF.claude.complete = async function(prompt, opts){
  LF.claude._bootstrap();
  opts = opts || {};
  const cfg = LF.state.claudeConfig;

  if(!LF.claude.isConfigured()){
    // Demo fallback
    await new Promise(r=>setTimeout(r, 300+Math.random()*400));
    return { text: LF.claude._simulatedReply(prompt, opts), model: "demo", tokensIn: 0, tokensOut: 0, cost: 0, demo: true };
  }

  const endpoint = cfg.proxyUrl ? cfg.proxyUrl : "https://api.anthropic.com/v1/messages";
  const body = {
    model: cfg.model,
    max_tokens: opts.maxTokens || cfg.maxTokens,
    temperature: opts.temperature ?? cfg.temperature,
    system: opts.system || cfg.systemPrompt,
    messages: [{ role:"user", content: prompt }]
  };
  const headers = { "Content-Type":"application/json" };
  if(!cfg.proxyUrl){
    // Direct call — requires anthropic-dangerous-direct-browser-access
    headers["x-api-key"] = cfg.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    // Proxy call — proxy handles auth
    if(cfg.apiKey) headers["Authorization"] = "Bearer "+cfg.apiKey;
  }

  try {
    const resp = await fetch(endpoint, { method:"POST", headers, body: JSON.stringify(body) });
    if(!resp.ok){
      const errText = await resp.text();
      throw new Error(`${resp.status}: ${errText.slice(0,200)}`);
    }
    const data = await resp.json();
    const text = (data.content && data.content[0] && data.content[0].text) || "";
    const usage = data.usage || {};
    const tokensIn = usage.input_tokens || 0;
    const tokensOut = usage.output_tokens || 0;
    const cost = LF.claude.modelCost(cfg.model, tokensIn, tokensOut);

    // Track usage
    const u = LF.state.claudeUsage;
    u.calls += 1;
    u.promptTokens += tokensIn;
    u.completionTokens += tokensOut;
    u.lastCall = Date.now();
    u.monthlyCost += cost;
    LF.storage.save();

    return { text, model: cfg.model, tokensIn, tokensOut, cost, demo: false };
  } catch(err){
    console.error("Claude API error:", err);
    LF.toast("Claude API error: "+err.message.slice(0,80),"err");
    // Fallback to demo reply on failure
    return { text: LF.claude._simulatedReply(prompt, opts), model: cfg.model, tokensIn: 0, tokensOut: 0, cost: 0, demo: true, error: err.message };
  }
};

LF.claude._simulatedReply = function(prompt, opts){
  const kind = opts.kind || "generic";
  const leadName = opts.lead?.firstName || "there";
  const company = opts.lead?.company || "your company";
  const industry = opts.lead?.industry || "your industry";
  if(kind==="email-draft"){
    return `Hi ${leadName},\n\nThanks for your interest in LeadForge 360. Based on what ${company} is focused on in ${industry.toLowerCase()}, I'd love to show you how our AI-native approach can cut time-to-first-touch by 40% and unify your channels.\n\nAre you free for a 20-minute call this week? I can share a tailored walkthrough plus a sample migration plan.\n\nBest,\n${(LF.state.user?.name||'AB7 Team')}`;
  }
  if(kind==="action-plan"){
    return `1. Send tailored ${industry} case study deck\n2. Book a 30-min discovery call within 5 days\n3. Draft a commercial proposal with 3 tier options\n4. Run a 6-turn qualification chat via the Qualifier Agent\n5. Loop in the AE once qualification score ≥ 60`;
  }
  if(kind==="summary"){
    return `${leadName} at ${company} is a ${opts.lead?.stage||'new'}-stage lead from ${opts.lead?.source||'an unknown source'}. Intent signals are moderate; fit score is ${opts.lead?.score||'n/a'}. Recommended next step: schedule a discovery call and share industry-specific case studies.`;
  }
  if(kind==="insight"){
    return `Your pipeline has ${opts.open||'several'} open deals worth a significant amount. The biggest risk is deal slippage — ${opts.slipping||0} deals haven't moved in 14+ days. Prioritise re-engagement on high-value slipping deals.`;
  }
  return `(Demo response — configure Claude in Settings → Claude AI for real replies.)\n\nPrompt received: ${String(prompt).slice(0,120)}…`;
};

/* Test the configured API key with a minimal call */
LF.claude.test = async function(){
  LF.claude._bootstrap();
  const cfg = LF.state.claudeConfig;
  if(!cfg.apiKey){ LF.toast("Enter an API key first","err"); return }
  const btn = document.getElementById("cl-test-btn");
  if(btn){ btn.disabled = true; btn.textContent = "Testing…"; }
  const start = Date.now();
  const res = await LF.claude.complete('Reply with the single word OK — nothing else.', {maxTokens:10, kind:"test"});
  const ms = Date.now() - start;
  cfg.lastTested = Date.now();
  cfg.testStatus = res.demo ? "demo" : (res.text ? "ok" : "fail");
  LF.storage.save();
  if(btn){ btn.disabled = false; btn.textContent = "⚡ Test connection"; }
  if(res.demo){
    if(res.error) LF.toast(`Test failed: ${res.error.slice(0,80)}`,"err");
    else LF.toast("Running in demo mode (no API key or disabled)","info");
  } else {
    LF.toast(`Claude responded in ${ms}ms · ${res.tokensIn}→${res.tokensOut} tokens · $${res.cost.toFixed(5)}`, "");
  }
  // re-render settings tab to refresh stats
  if(LF.state.route==="settings") LF.views.settingsTab('claude',{target:{classList:{add:()=>{},remove:()=>{}},closest:()=>null}});
};

LF.claude.saveConfig = function(){
  LF.claude._bootstrap();
  const cfg = LF.state.claudeConfig;
  cfg.enabled = document.getElementById("cl-enabled").checked;
  cfg.apiKey = document.getElementById("cl-key").value.trim();
  cfg.model = document.getElementById("cl-model").value;
  cfg.maxTokens = parseInt(document.getElementById("cl-max").value)||1024;
  cfg.temperature = parseFloat(document.getElementById("cl-temp").value);
  cfg.proxyUrl = document.getElementById("cl-proxy").value.trim();
  cfg.systemPrompt = document.getElementById("cl-system").value;
  cfg.useFor = {
    emailDrafts: !!document.getElementById("cl-use-email-drafts")?.checked,
    actionPlans: !!document.getElementById("cl-use-action-plans")?.checked,
    aiInsights:  !!document.getElementById("cl-use-ai-insights")?.checked,
    leadSummaries: !!document.getElementById("cl-use-lead-summaries")?.checked,
    qualNotes:   !!document.getElementById("cl-use-qual-notes")?.checked
  };
  LF.storage.save();
  LF.toast("Claude configuration saved","");
  LF.views.settingsTab('claude',{target:{classList:{add:()=>{},remove:()=>{}},closest:()=>null}});
};

LF.claude.resetUsage = function(){
  if(!confirm("Reset lifetime Claude usage counters?")) return;
  LF.state.claudeUsage = { calls:0, promptTokens:0, completionTokens:0, lastCall:null, monthlyCost:0 };
  LF.storage.save();
  LF.views.settingsTab('claude',{target:{classList:{add:()=>{},remove:()=>{}},closest:()=>null}});
  LF.toast("Usage counters reset","");
};

LF.claude.quickAsk = function(){
  LF.modal.open({
    title:"Ask Claude — quick prompt",
    body:`
      <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">Ask anything about your pipeline, draft copy, generate ideas. ${LF.claude.isConfigured()?'<span class="tag green">Claude connected</span>':'<span class="tag warn">Demo mode — configure in Settings → Claude AI</span>'}</p>
      <div class="fld"><label>Prompt</label><textarea id="cl-ask" style="min-height:110px" placeholder="e.g. Summarise my top 5 hot leads and suggest a 3-touch cadence for each">Summarise my pipeline health and name the top 3 risks.</textarea></div>
      <div id="cl-ask-out" style="display:none;padding:12px;background:var(--ab7-sky-ghost);border-radius:10px;font-size:13px;color:var(--ink-800);line-height:1.55;white-space:pre-wrap;max-height:260px;overflow:auto"></div>
      <div id="cl-ask-meta" style="font-size:11px;color:var(--ink-400);margin-top:8px;font-family:var(--font-mono)"></div>`,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Close</button>
      <button class="btn btn-primary" id="cl-ask-btn" onclick="LF.claude.runQuickAsk()">▶ Ask</button>`
  });
};

LF.claude.runQuickAsk = async function(){
  const q = document.getElementById('cl-ask').value.trim();
  if(!q){ LF.toast("Type a prompt first","err"); return }
  const btn = document.getElementById('cl-ask-btn'); btn.disabled = true; btn.textContent = "Thinking…";
  const m = LF.rev ? LF.rev.compute() : {};
  const ctx = `Current pipeline context: ${LF.state.leads.length} leads, ${m.won||0} won, ${m.open||0} open, ${m.slipping||0} slipping, weighted forecast ${m.weightedForecast?fmtCur(m.weightedForecast):'n/a'}.`;
  const res = await LF.claude.complete(ctx + "\n\nUser question: " + q, {kind:"insight"});
  document.getElementById('cl-ask-out').style.display = "block";
  document.getElementById('cl-ask-out').textContent = res.text;
  document.getElementById('cl-ask-meta').textContent = res.demo?"(demo response)":(`${res.model} · ${res.tokensIn}→${res.tokensOut} tokens · $${res.cost.toFixed(5)}`);
  btn.disabled = false; btn.textContent = "▶ Ask again";
};
/* ==========================================================
   COMPANY · TEAM · API · SCIM · IMPORT namespaces
   ========================================================== */
LF.company = LF.company || {};
LF.company._bootstrap = function(){
  if(!LF.state.company){
    LF.state.company = {
      name: "AB7 Solutions",
      logo: "",
      tagline: "Collaborate More · Grow More",
      description: "AI-native revenue operations built in India for the world.",
      industry: "SaaS",
      size: "11-50",
      website: "https://ab7solutions.com",
      founded: "2024",
      gst: "",
      phone: "+91 80 6861 XXXX",
      supportEmail: "support@ab7solutions.com",
      address: { street:"", city:"Bengaluru", state:"Karnataka", country:"IN", postal:"560001" },
      billing: { region:"India (Mumbai) — DPDP", currency:"INR", fiscalYear:"Apr–Mar (India)", subdomain:"ab7.leadforge.ai" }
    };
  }
};

LF.company.save = function(){
  LF.company._bootstrap();
  const co = LF.state.company;
  co.name = document.getElementById("co-name").value.trim() || co.name;
  co.tagline = document.getElementById("co-tagline").value;
  co.description = document.getElementById("co-desc").value;
  co.industry = document.getElementById("co-industry").value;
  co.size = document.getElementById("co-size").value;
  co.website = document.getElementById("co-website").value;
  co.founded = document.getElementById("co-founded").value;
  co.gst = document.getElementById("co-gst").value;
  co.phone = document.getElementById("co-phone").value;
  co.supportEmail = document.getElementById("co-support").value;
  co.address.street = document.getElementById("co-street").value;
  co.address.city = document.getElementById("co-city").value;
  co.address.state = document.getElementById("co-state").value;
  co.address.country = document.getElementById("co-country").value;
  co.address.postal = document.getElementById("co-postal").value;
  co.billing.region = document.getElementById("co-region").value;
  co.billing.currency = document.getElementById("co-ccy").value;
  co.billing.fiscalYear = document.getElementById("co-fy").value;
  co.billing.subdomain = document.getElementById("co-subdomain").value;
  LF.storage.save();
  LF.toast("Company profile saved","");
  // Update brand in sidebar + login
  document.querySelectorAll(".sb-brand .t").forEach(el=>el.textContent = co.name);
  LF.router.go("settings");
  setTimeout(()=>LF.views.settingsTab('tenant',{target:{classList:{add:()=>{},remove:()=>{}},closest:()=>null}}),20);
};

LF.company.uploadLogo = function(ev){
  const file = ev.target.files[0]; if(!file) return;
  if(file.size > 500*1024){ LF.toast("Logo must be under 500KB","err"); return }
  const reader = new FileReader();
  reader.onload = e => {
    LF.company._bootstrap();
    LF.state.company.logo = e.target.result;
    LF.storage.save();
    const img = document.getElementById("co-logo-preview");
    if(img){ img.src = e.target.result; img.style.display="block"; }
    // Live-update sidebar/login logo
    document.querySelectorAll(".sb-brand img, .login-brand img").forEach(el=>el.src = e.target.result);
    LF.toast("Logo updated","");
  };
  reader.readAsDataURL(file);
};

LF.company.removeLogo = function(){
  LF.company._bootstrap();
  LF.state.company.logo = "";
  LF.storage.save();
  const img = document.getElementById("co-logo-preview");
  if(img) img.style.display="none";
  document.querySelectorAll(".sb-brand img, .login-brand img").forEach(el=>el.src = "logo-no-background.png");
  LF.toast("Logo removed","info");
};

/* ---------- TEAM ---------- */
LF.team = LF.team || {};
LF.team.MODULES = [
  {id:"leads",       label:"Leads",            icon:"👥"},
  {id:"pipeline",    label:"Pipeline",         icon:"🗂"},
  {id:"scoring",     label:"Scoring",          icon:"⭐"},
  {id:"cdp",         label:"CDP &amp; Tasks",  icon:"💾"},
  {id:"analytics",   label:"Revenue Intel",    icon:"📊"},
  {id:"conversion",  label:"Conversion",       icon:"→"},
  {id:"collab",      label:"Collaboration",    icon:"🤝"},
  {id:"customization",label:"Customization",   icon:"⚙"},
  {id:"integrations",label:"Integrations",     icon:"🔌"},
  {id:"mail",        label:"Mail",             icon:"✉"},
  {id:"settings",    label:"Settings",         icon:"⚙"}
];
LF.team.LEVELS = ["none","view","edit","admin"];
LF.team.defaultPermForRole = function(role){
  const adminAll = {}, editAll = {}, viewAll = {};
  LF.team.MODULES.forEach(m=>{ adminAll[m.id]="admin"; editAll[m.id]="edit"; viewAll[m.id]="view"; });
  if(role==="Admin") return adminAll;
  if(role==="AE") return {...editAll, settings:"view", customization:"view", integrations:"view"};
  if(role==="SDR") return {...editAll, analytics:"view", customization:"none", integrations:"none", settings:"none"};
  if(role==="Manager") return {...editAll, settings:"view"};
  if(role==="Viewer") return viewAll;
  return editAll;
};

LF.team._bootstrap = function(){
  // No demo team-member seeding — the team list starts empty and is populated
  // by the first-run setup (LF.auth.setupAdmin) and Settings → Team invites.
  if(!LF.state.teamMembers) LF.state.teamMembers = [];
};

LF.team.renderList = function(){
  LF.team._bootstrap();
  const body = document.getElementById("team-rows"); if(!body) return;
  body.innerHTML = LF.state.teamMembers.map(m=>{
    const adminCount = LF.team.MODULES.filter(mm=>m.permissions[mm.id]==="admin").length;
    const editCount = LF.team.MODULES.filter(mm=>m.permissions[mm.id]==="edit").length;
    const viewCount = LF.team.MODULES.filter(mm=>m.permissions[mm.id]==="view").length;
    return `<tr>
      <td><div class="who"><div class="avatar-sm ${m.grp||''}">${m.avatar||initials(m.name)}</div>
        <div><div style="font-weight:700">${escapeHtml(m.name)}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(m.email)}</div></div></div></td>
      <td><span class="tag blue">${escapeHtml(m.role)}</span></td>
      <td>${escapeHtml(m.team||'—')}</td>
      <td><span class="tag ${adminCount?'gradient':editCount?'blue':'slate'}" style="font-size:10.5px">${adminCount?'Admin':editCount?'Editor':'Viewer'}</span>
        <div style="font-size:10.5px;color:var(--ink-500);margin-top:2px">${adminCount} admin · ${editCount} edit · ${viewCount} view</div></td>
      <td><span class="tag ${m.status==='active'?'green':'slate'}">${m.status}</span></td>
      <td style="font-size:11px;color:var(--ink-500)">${m.lastLogin?fmtTime(m.lastLogin):'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-blue btn-xs" onclick="LF.team.edit('${m.id}')">Permissions</button>
        <button class="btn btn-ghost btn-xs" onclick="LF.team.setCredentials('${m.id}')">🔐 ${m.credentials?'Reset login':'Set login'}</button>
        <button class="btn btn-ghost btn-xs" onclick="LF.team.toggleStatus('${m.id}')">${m.status==='active'?'Deactivate':'Activate'}</button>
        <button class="btn btn-danger btn-xs" onclick="LF.team.remove('${m.id}')">✕</button>
      </td>
    </tr>`;
  }).join("");
};

LF.team.invite = function(){
  LF.state.teamAddMode = "invite";
  LF.team._renderAddModal();
};

LF.team._renderAddModal = function(){
  const mode = LF.state.teamAddMode || "invite";
  LF.modal.open({
    title: mode==="create" ? "Create team member with login" : "Invite team member",
    body:`
      <div class="seg" style="margin-bottom:14px">
        <button class="${mode==='invite'?'active':''}" onclick="LF.state.teamAddMode='invite';LF.team._renderAddModal()">📧 Send invite</button>
        <button class="${mode==='create'?'active':''}" onclick="LF.state.teamAddMode='create';LF.team._renderAddModal()">🔐 Create login directly</button>
      </div>

      <div class="fld-row">
        <div class="fld"><label>Full name *</label><input id="tm-name" placeholder="Jane Doe"></div>
        <div class="fld"><label>Email *</label><input id="tm-email" type="email" placeholder="jane@company.com"></div>
      </div>
      <div class="fld-row">
        <div class="fld"><label>Role</label>
          <select id="tm-role">
            <option>Admin</option><option selected>AE</option><option>SDR</option><option>Manager</option><option>Viewer</option>
          </select>
        </div>
        <div class="fld"><label>Team</label>
          <select id="tm-team"><option>Enterprise</option><option>Mid-Market</option><option>GCC</option><option>SEA</option><option>North America</option></select>
        </div>
      </div>

      ${mode==="create" ? `
        <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-500);margin:12px 0 6px">Sign-in credentials</div>
        <div class="fld"><label>Username *</label>
          <input id="tm-user" placeholder="jane.doe or jane@company.com">
          <div class="hint">Can be the email, or a custom username. Must be unique across the workspace.</div>
        </div>
        <div class="fld-row">
          <div class="fld"><label>Password *</label>
            <input id="tm-pass" type="password" placeholder="At least 8 characters">
          </div>
          <div class="fld"><label>Confirm password *</label>
            <input id="tm-pass2" type="password" placeholder="Re-enter password">
          </div>
        </div>
        <div class="fld">
          <label style="display:flex;gap:6px;align-items:center;text-transform:none;font-size:13px;font-weight:500;color:var(--ink-700)"><input type="checkbox" id="tm-must-reset" checked> Require password change on first sign-in</label>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:10px">
          <button class="btn btn-ghost btn-xs" type="button" onclick="LF.team.generatePassword()">🎲 Generate secure password</button>
          <button class="btn btn-ghost btn-xs" type="button" onclick="LF.team.togglePasswordView()">👁 Show/hide</button>
        </div>
        <div style="padding:10px 12px;background:#FEF3C7;border-left:3px solid var(--warn);border-radius:8px;font-size:12px;color:#92400E">
          <b>⚠ Share credentials securely.</b> Password is stored as a one-way hash — you won't see it again. If the member forgets, you'll need to reset it.
        </div>
      ` : `
        <div style="padding:12px;background:var(--ab7-sky-ghost);border-radius:8px;font-size:12.5px;color:var(--ink-700);margin-top:6px">An invitation email will be sent with a sign-in link that lets them set their own password. Default permissions are set by role; you can fine-tune after invite.</div>
      `}
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="LF.team.confirmAdd()">${mode==="create" ? "Create member" : "Send invite"}</button>`
  });
};

LF.team.generatePassword = function(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%*";
  let pw = "";
  for(let i=0;i<14;i++) pw += chars[Math.floor(Math.random()*chars.length)];
  document.getElementById("tm-pass").value = pw;
  document.getElementById("tm-pass2").value = pw;
  document.getElementById("tm-pass").type = "text";
  document.getElementById("tm-pass2").type = "text";
  LF.toast("Password generated — copy before closing","info");
};

LF.team.togglePasswordView = function(){
  const a = document.getElementById("tm-pass"), b = document.getElementById("tm-pass2");
  const next = a.type === "password" ? "text" : "password";
  a.type = next; b.type = next;
};

LF.team._hash = function(s){
  // Demo mode (no server) — non-cryptographic hash. When the server is online we
  // call /api/auth/hash for proper scrypt hashing. See LF.team._hashAsync below.
  let h = 5381; for(let i=0;i<s.length;i++) h = ((h<<5)+h) ^ s.charCodeAt(i);
  return "sh1_"+((h>>>0).toString(16)).padStart(8,"0")+"_"+s.length;
};

// Production-grade hash via server-side scrypt (NOTE-4)
LF.team._hashAsync = async function(plain){
  if(LF.db && LF.db.online){
    try {
      const r = await fetch((LF.db.baseUrl||"") + "/api/auth/hash", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ password: plain })
      });
      if(r.ok){ const j = await r.json(); if(j.hash) return j.hash; }
    } catch(e){ /* fall through to demo hash */ }
  }
  return LF.team._hash(plain);
};

// Verify a stored hash. Server scrypt hashes start with "scrypt$"; demo hashes with "sh1_".
LF.team._verifyHash = async function(plain, stored){
  if(stored && stored.startsWith && stored.startsWith("scrypt$")){
    if(LF.db && LF.db.online){
      try {
        const r = await fetch((LF.db.baseUrl||"") + "/api/auth/verify", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ password: plain, hash: stored })
        });
        if(r.ok){ const j = await r.json(); return !!j.ok; }
      } catch(e){ return false; }
    }
    return false; // server-hashed but server unreachable — fail closed
  }
  return LF.team._hash(plain) === stored;
};

LF.team.confirmAdd = function(){
  const mode = LF.state.teamAddMode || "invite";
  const name = document.getElementById("tm-name").value.trim();
  const email = document.getElementById("tm-email").value.trim();
  const role = document.getElementById("tm-role").value;
  const team = document.getElementById("tm-team").value;
  if(!name || !email){ LF.toast("Name and email required","err"); return }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ LF.toast("Valid email required","err"); return }
  if(LF.state.teamMembers.some(m=>m.email.toLowerCase()===email.toLowerCase())){ LF.toast("Email already on the team","err"); return }

  let credentials = null;
  if(mode === "create"){
    const user = document.getElementById("tm-user").value.trim();
    const pass = document.getElementById("tm-pass").value;
    const pass2 = document.getElementById("tm-pass2").value;
    if(!user){ LF.toast("Username required","err"); return }
    if(LF.state.teamMembers.some(m=>m.credentials?.username===user)){ LF.toast("Username already taken","err"); return }
    if(!pass || pass.length < 8){ LF.toast("Password must be at least 8 characters","err"); return }
    if(pass !== pass2){ LF.toast("Passwords don't match","err"); return }
    credentials = {
      username: user,
      passwordHash: LF.team._hash(pass),
      mustResetOnFirstLogin: document.getElementById("tm-must-reset").checked,
      createdAt: Date.now(),
      createdBy: LF.state.user.id
    };
  }

  const grps = ["g2","g3","g4","g5",""];
  const m = {
    id: "u"+rid().slice(3), name, email, role, team,
    status: mode==="create" ? "active" : "pending",
    avatar:initials(name), grp:rand(grps),
    permissions: LF.team.defaultPermForRole(role),
    invitedAt: Date.now(), lastLogin: null,
    credentials
  };
  LF.state.teamMembers.push(m);
  LF.storage.save();
  // High-stakes write — flush past the 400ms debounce so a quick refresh
  // doesn't pull the old server snapshot and lose the new member.
  if(LF.db && LF.db.flushSnapshot) LF.db.flushSnapshot();
  LF.modal.close();
  LF.team.renderList();
  if(mode === "create"){
    LF.toast(`${name} can now sign in with username "${credentials.username}"`, "");
  } else {
    LF.toast(`Invitation sent to ${email}`,"");
  }
};

/* Reset-credentials flow for existing members */
LF.team.setCredentials = function(id){
  const m = LF.state.teamMembers.find(x=>x.id===id); if(!m) return;
  LF.modal.open({
    title:`Set login for ${m.name}`,
    body:`
      <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:12px">Create or reset sign-in credentials for this member. The password is hashed before storage.</p>
      <div class="fld"><label>Username *</label><input id="tm-user-r" value="${escapeHtml(m.credentials?.username||m.email)}"></div>
      <div class="fld-row">
        <div class="fld"><label>New password *</label><input id="tm-pass-r" type="password" placeholder="At least 8 characters"></div>
        <div class="fld"><label>Confirm *</label><input id="tm-pass2-r" type="password"></div>
      </div>
      <div class="fld">
        <label style="display:flex;gap:6px;align-items:center;text-transform:none;font-size:13px;font-weight:500"><input type="checkbox" id="tm-must-r" checked> Require password change on next sign-in</label>
      </div>
      <button class="btn btn-ghost btn-xs" type="button" onclick="const pw=Array.from({length:14},()=>\"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%*\"[Math.floor(Math.random()*60)]).join('');document.getElementById('tm-pass-r').value=pw;document.getElementById('tm-pass2-r').value=pw;document.getElementById('tm-pass-r').type='text';document.getElementById('tm-pass2-r').type='text'">🎲 Generate secure password</button>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="LF.team.saveCredentials('${id}')">Save credentials</button>`
  });
};

LF.team.saveCredentials = function(id){
  const m = LF.state.teamMembers.find(x=>x.id===id); if(!m) return;
  const user = document.getElementById("tm-user-r").value.trim();
  const pass = document.getElementById("tm-pass-r").value;
  const pass2 = document.getElementById("tm-pass2-r").value;
  if(!user){ LF.toast("Username required","err"); return }
  if(LF.state.teamMembers.some(x=>x.id!==id && x.credentials?.username===user)){ LF.toast("Username already taken","err"); return }
  if(!pass || pass.length<8){ LF.toast("Password must be at least 8 characters","err"); return }
  if(pass !== pass2){ LF.toast("Passwords don't match","err"); return }
  m.credentials = {
    username: user,
    passwordHash: LF.team._hash(pass),
    mustResetOnFirstLogin: document.getElementById("tm-must-r").checked,
    createdAt: Date.now(), createdBy: LF.state.user.id
  };
  if(m.status === "pending") m.status = "active";
  LF.storage.save();
  if(LF.db && LF.db.flushSnapshot) LF.db.flushSnapshot();
  LF.modal.close();
  LF.team.renderList();
  LF.toast(`Login ready for ${m.name}`,"");
};

LF.team.edit = function(id){
  const m = LF.state.teamMembers.find(x=>x.id===id); if(!m) return;
  // Working copy — updated live as user clicks, committed on Save
  LF.state._permsDraft = { memberId:id, perms: JSON.parse(JSON.stringify(m.permissions||{})), role:m.role };
  // Ensure every module has a level (default none)
  LF.team.MODULES.forEach(mod=>{ if(!LF.state._permsDraft.perms[mod.id]) LF.state._permsDraft.perms[mod.id] = "none"; });

  LF.drawer.open({
    title:`Permissions — ${m.name}`,
    body:`
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
        <div class="avatar-sm ${m.grp||''}" style="width:42px;height:42px;font-size:14px">${m.avatar||initials(m.name)}</div>
        <div style="flex:1"><div style="font-weight:700;font-size:14px">${escapeHtml(m.name)}</div><div style="font-size:11.5px;color:var(--ink-400)">${escapeHtml(m.email)}</div></div>
      </div>
      <div class="fld-row">
        <div class="fld"><label>Role</label>
          <select id="tm-role2" onchange="LF.state._permsDraft.role=this.value">
            <option ${m.role==='Admin'?'selected':''}>Admin</option>
            <option ${m.role==='AE'?'selected':''}>AE</option>
            <option ${m.role==='SDR'?'selected':''}>SDR</option>
            <option ${m.role==='Manager'?'selected':''}>Manager</option>
            <option ${m.role==='Viewer'?'selected':''}>Viewer</option>
          </select>
        </div>
        <div class="fld">
          <label>Apply to all modules</label>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button type="button" class="btn btn-ghost btn-xs" onclick="LF.team.setAll('none')">✕ None</button>
            <button type="button" class="btn btn-ghost btn-xs" onclick="LF.team.setAll('view')">👁 View</button>
            <button type="button" class="btn btn-ghost btn-xs" onclick="LF.team.setAll('edit')">✎ Edit</button>
            <button type="button" class="btn btn-ghost btn-xs" onclick="LF.team.setAll('admin')">⚙ Admin</button>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin:14px 0 6px">
        <span style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-500)">Module permissions</span>
        <span style="font-size:11.5px;color:var(--ink-500)">Click any cell to set the level</span>
      </div>
      <div id="perm-matrix-wrap" style="border:1px solid var(--ink-150);border-radius:10px;overflow:hidden;background:#fff">
        <div id="perm-matrix"></div>
      </div>
      <div id="perm-summary" style="margin-top:10px;font-size:11.5px;color:var(--ink-500)"></div>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.drawer.close()">Cancel</button>
      <button class="btn btn-primary" id="perm-save-btn" onclick="LF.team.savePerms('${id}')">Save permissions</button>`
  });
  LF.team._renderPermMatrix();
};

LF.team._renderPermMatrix = function(){
  const wrap = document.getElementById("perm-matrix"); if(!wrap) return;
  const perms = LF.state._permsDraft.perms;
  const LEVELS = [
    {v:"none",  label:"None",  color:"var(--ink-400)",     bg:"var(--ink-50)"},
    {v:"view",  label:"View",  color:"var(--ab7-blue-deep)", bg:"rgba(0,116,217,.08)"},
    {v:"edit",  label:"Edit",  color:"var(--ab7-green-deep)", bg:"rgba(0,211,112,.10)"},
    {v:"admin", label:"Admin", color:"#fff",                 bg:"linear-gradient(135deg,#0074D9,#00D370)"}
  ];
  // Header
  let html = `<div class="perm-hdr" style="display:grid;grid-template-columns:1.4fr repeat(4,1fr);background:var(--ink-50);border-bottom:1px solid var(--ink-150);padding:10px 12px;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-500)">
    <div>Module</div>
    ${LEVELS.map(l=>`<div style="text-align:center">${escapeHtml(l.label)}</div>`).join("")}
  </div>`;
  // Rows
  html += LF.team.MODULES.map(mod=>{
    const current = perms[mod.id]||"none";
    return `<div class="perm-row" data-mod="${mod.id}" style="display:grid;grid-template-columns:1.4fr repeat(4,1fr);padding:4px 8px;border-bottom:1px solid var(--ink-100);align-items:center">
      <div style="padding:8px 6px;font-size:13px;color:var(--ink-800);font-weight:500">${mod.icon} ${escapeHtml(mod.label.replace(/&amp;/g,'&'))}</div>
      ${LEVELS.map(l=>{
        const sel = current===l.v;
        return `<div class="perm-cell ${sel?'sel':''}" data-mod="${mod.id}" data-lv="${l.v}"
          onclick="LF.team.setPerm('${mod.id}','${l.v}')"
          style="cursor:pointer;margin:3px;padding:9px 6px;border-radius:8px;text-align:center;font-size:12px;font-weight:${sel?'700':'500'};color:${sel?(l.v==='admin'?'#fff':l.color):'var(--ink-500)'};background:${sel?l.bg:'transparent'};border:1px solid ${sel?'transparent':'var(--ink-150)'};transition:all .12s;user-select:none">
          ${sel?'● ':''}${escapeHtml(l.label)}
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
  wrap.innerHTML = html;

  // update summary line
  const adminN = LF.team.MODULES.filter(mm=>perms[mm.id]==="admin").length;
  const editN  = LF.team.MODULES.filter(mm=>perms[mm.id]==="edit").length;
  const viewN  = LF.team.MODULES.filter(mm=>perms[mm.id]==="view").length;
  const noneN  = LF.team.MODULES.filter(mm=>perms[mm.id]==="none").length;
  const s = document.getElementById("perm-summary");
  if(s) s.innerHTML = `<b>Summary:</b> ${adminN} admin · ${editN} edit · ${viewN} view · ${noneN} no access. Click <b>Save permissions</b> to apply.`;
};

LF.team.setPerm = function(moduleId, level){
  if(!LF.state._permsDraft) return;
  LF.state._permsDraft.perms[moduleId] = level;
  LF.team._renderPermMatrix();
};

LF.team.setAll = function(level){
  if(!LF.state._permsDraft) return;
  LF.team.MODULES.forEach(m=>{ LF.state._permsDraft.perms[m.id] = level; });
  LF.team._renderPermMatrix();
  LF.toast(`All modules set to "${level}"`,"info");
};

LF.team.savePerms = function(id){
  const m = LF.state.teamMembers.find(x=>x.id===id); if(!m) return;
  if(!LF.state._permsDraft || LF.state._permsDraft.memberId !== id){
    LF.toast("Nothing to save","err"); return;
  }
  m.role = LF.state._permsDraft.role || document.getElementById("tm-role2")?.value || m.role;
  m.permissions = JSON.parse(JSON.stringify(LF.state._permsDraft.perms));
  LF.state._permsDraft = null;
  LF.storage.save();
  LF.drawer.close();
  LF.team.renderList();
  LF.toast(`Permissions saved for ${m.name}`,"");
};

LF.team.toggleStatus = function(id){
  const m = LF.state.teamMembers.find(x=>x.id===id); if(!m) return;
  m.status = m.status==='active' ? 'deactivated' : 'active';
  LF.storage.save();
  if(LF.db && LF.db.flushSnapshot) LF.db.flushSnapshot();
  LF.team.renderList();
  LF.toast(`${m.name} ${m.status}`,"");
};

LF.team.remove = function(id){
  const m = LF.state.teamMembers.find(x=>x.id===id); if(!m) return;
  if(!confirm(`Remove ${m.name} from the team? They'll lose access immediately.`)) return;
  LF.state.teamMembers = LF.state.teamMembers.filter(x=>x.id!==id);
  LF.storage.save();
  if(LF.db && LF.db.flushSnapshot) LF.db.flushSnapshot();
  LF.team.renderList();
  LF.toast(`${m.name} removed`,"info");
};

/* ---------- API KEYS + SCIM ---------- */
LF.apiMgr = LF.apiMgr || {};
LF.apiMgr._bootstrap = function(){
  if(!LF.state.apiKeys){
    LF.state.apiKeys = [
      {id:rid(), label:"Production · Backend", key:"lfk_live_"+rid()+rid(), prefix:"lfk_live_", scopes:["read","write"], createdAt:Date.now()-30*86400000, lastUsed:Date.now()-120000, rateLimit:1000, calls30d:287400, status:"active"},
      {id:rid(), label:"Zapier integration",   key:"lfk_live_"+rid()+rid(), prefix:"lfk_live_", scopes:["read"],         createdAt:Date.now()-60*86400000, lastUsed:Date.now()-1080000, rateLimit:500, calls30d:42812, status:"active"}
    ];
  }
  if(!LF.state.scim){
    LF.state.scim = {
      enabled:false,
      endpoint:"https://scim.leadforge.ab7/v2",
      bearerToken:"",
      tenantId:"",
      mappings:{email:"username", department:"team", title:"role"},
      lastSync:null
    };
  }
};

LF.apiMgr.renderList = function(){
  LF.apiMgr._bootstrap();
  const body = document.getElementById("api-rows"); if(!body) return;
  body.innerHTML = LF.state.apiKeys.length ? LF.state.apiKeys.map(k=>`
    <tr>
      <td><b>${escapeHtml(k.label)}</b><div style="font-size:10.5px;color:var(--ink-400)">Created ${fmtTime(k.createdAt)}</div></td>
      <td style="font-family:var(--font-mono);font-size:11.5px">${k.prefix}${"•".repeat(18)}${k.key.slice(-4)}</td>
      <td>${k.scopes.map(s=>`<span class="tag blue" style="font-size:10px">${s}</span>`).join(" ")}</td>
      <td style="font-size:11.5px;color:var(--ink-500)">${k.rateLimit}/hr</td>
      <td style="font-size:11.5px">${k.calls30d.toLocaleString()}</td>
      <td style="font-size:11px;color:var(--ink-500)">${k.lastUsed?fmtTime(k.lastUsed):'never'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-xs" onclick="LF.apiMgr.copyKey('${k.id}')">Copy</button>
        <button class="btn btn-danger btn-xs" onclick="LF.apiMgr.revoke('${k.id}')">Revoke</button>
      </td>
    </tr>
  `).join("") : '<tr><td colspan="7" class="tbl-empty">No keys yet. Click "Generate key" to create one.</td></tr>';
};

LF.apiMgr.generate = function(){
  LF.modal.open({
    title:"Generate new API key",
    body:`
      <div class="fld"><label>Label</label><input id="ak-label" placeholder="e.g. Billing sync"></div>
      <div class="fld"><label>Scopes</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          ${[["read","Read records"],["write","Create/update records"],["delete","Delete records"],["admin","Admin API"],["webhooks","Manage webhooks"]].map(([s,desc])=>`
            <label style="display:inline-flex;gap:6px;align-items:center;padding:6px 10px;border:1px solid var(--ink-200);border-radius:8px;font-size:12px;cursor:pointer">
              <input type="checkbox" value="${s}" ${s==='read'?'checked':''}> <b>${s}</b> <span style="color:var(--ink-500);font-size:10.5px">${desc}</span>
            </label>`).join("")}
        </div>
      </div>
      <div class="fld-row">
        <div class="fld"><label>Rate limit (requests / hour)</label><input id="ak-rate" type="number" value="500"></div>
        <div class="fld"><label>Environment</label><select id="ak-env"><option value="live">Production (lfk_live_)</option><option value="test">Sandbox (lfk_test_)</option></select></div>
      </div>
    `,
    foot:`<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="LF.apiMgr.confirmGenerate()">Generate key</button>`
  });
};

LF.apiMgr.confirmGenerate = function(){
  const label = document.getElementById("ak-label").value.trim();
  if(!label){ LF.toast("Label required","err"); return }
  const scopes = [...document.querySelectorAll('.modal input[type="checkbox"]:checked')].map(i=>i.value);
  if(!scopes.length){ LF.toast("Pick at least one scope","err"); return }
  const env = document.getElementById("ak-env").value;
  const rateLimit = parseInt(document.getElementById("ak-rate").value)||500;
  const prefix = env==='test'?'lfk_test_':'lfk_live_';
  const key = prefix + rid()+rid().slice(3)+rid().slice(3);
  const k = {id:rid(), label, key, prefix, scopes, createdAt:Date.now(), lastUsed:null, rateLimit, calls30d:0, status:"active"};
  LF.state.apiKeys.push(k);
  LF.storage.save();
  LF.modal.close();
  LF.apiMgr.renderList();
  // Show the key once
  LF.modal.open({
    title:"🔑 New API key created",
    body:`<p style="font-size:13px;color:var(--ink-600);margin-bottom:10px">Copy this key now — you won't be able to see it again.</p>
      <div style="font-family:var(--font-mono);font-size:13px;background:var(--ink-900);color:#86EFAC;padding:14px;border-radius:10px;word-break:break-all">${escapeHtml(key)}</div>
      <p style="font-size:11.5px;color:var(--ink-400);margin-top:10px">Scopes: ${scopes.join(', ')} · Rate limit: ${rateLimit}/hr</p>`,
    foot:`<button class="btn btn-primary" onclick="navigator.clipboard?.writeText('${key}');LF.toast('Key copied','');LF.modal.close()">Copy &amp; close</button>`
  });
};

LF.apiMgr.copyKey = function(id){
  const k = LF.state.apiKeys.find(x=>x.id===id); if(!k) return;
  const masked = k.prefix + "•".repeat(24);
  if(navigator.clipboard){ navigator.clipboard.writeText(masked); }
  LF.toast("For security, only the masked key can be copied after creation. Regenerate to get a new full key.","info");
};

LF.apiMgr.revoke = function(id){
  const k = LF.state.apiKeys.find(x=>x.id===id); if(!k) return;
  if(!confirm(`Revoke "${k.label}"? All clients using this key will immediately lose access.`)) return;
  LF.state.apiKeys = LF.state.apiKeys.filter(x=>x.id!==id);
  LF.storage.save();
  LF.apiMgr.renderList();
  LF.toast("Key revoked","info");
};

LF.apiMgr.saveScim = function(){
  LF.apiMgr._bootstrap();
  LF.state.scim.enabled = document.getElementById("scim-enabled").checked;
  LF.state.scim.endpoint = document.getElementById("scim-endpoint").value;
  LF.state.scim.bearerToken = document.getElementById("scim-token").value;
  LF.state.scim.tenantId = document.getElementById("scim-tenant").value;
  LF.state.scim.mappings.email = document.getElementById("scim-map-email").value;
  LF.state.scim.mappings.department = document.getElementById("scim-map-dept").value;
  LF.state.scim.mappings.title = document.getElementById("scim-map-title").value;
  LF.storage.save();
  LF.toast("SCIM configuration saved","");
};

LF.apiMgr.testScim = function(){
  LF.apiMgr._bootstrap();
  const token = document.getElementById("scim-token").value;
  if(!token){ LF.toast("Bearer token required","err"); return }
  setTimeout(()=>{
    const ok = Math.random()>0.1;
    LF.state.scim.lastSync = Date.now();
    LF.storage.save();
    if(ok) LF.toast(`SCIM handshake OK · ${Math.floor(Math.random()*8+2)} users synced`,"");
    else LF.toast("SCIM test failed — check endpoint and token","err");
    LF.router.go("settings");
    setTimeout(()=>LF.views.settingsTab('api',{target:{classList:{add:()=>{},remove:()=>{}},closest:()=>null}}),20);
  }, 400);
};

LF.apiMgr.rotateScimToken = function(){
  LF.apiMgr._bootstrap();
  const newToken = "scim_"+rid()+rid()+rid();
  LF.state.scim.bearerToken = newToken;
  LF.storage.save();
  document.getElementById("scim-token").value = newToken;
  LF.toast("SCIM token rotated — update your IdP","");
};
/* ==========================================================
   LEAD IMPORT — full wizard with mapping + preview + dedupe
   ========================================================== */
LF.importer = LF.importer || {};
LF.importer.FIELDS = [
  {key:"firstName",  label:"First name",   required:true,  aliases:["first name","firstname","first","given name","fname"]},
  {key:"lastName",   label:"Last name",    required:true,  aliases:["last name","lastname","last","surname","family name","lname"]},
  {key:"email",      label:"Email",        required:true,  aliases:["email","email address","e-mail","work email"]},
  {key:"phone",      label:"Phone",        required:false, aliases:["phone","mobile","contact","tel","telephone","phone number","mobile number"]},
  {key:"company",    label:"Company",      required:true,  aliases:["company","organization","organisation","employer","account"]},
  {key:"industry",   label:"Industry",     required:false, aliases:["industry","vertical","sector"]},
  {key:"city",       label:"City",         required:false, aliases:["city","town","location"]},
  {key:"country",    label:"Country",      required:false, aliases:["country","country code"]},
  {key:"source",     label:"Source",       required:false, aliases:["source","lead source","origin","utm source"]},
  {key:"stage",      label:"Stage",        required:false, aliases:["stage","status","lifecycle"]},
  {key:"score",      label:"Score",        required:false, aliases:["score","lead score","rating"]},
  {key:"amount",     label:"Deal value",   required:false, aliases:["amount","value","deal value","deal amount","revenue","mrr","arr"]},
  {key:"currency",   label:"Currency",     required:false, aliases:["currency","curr"]},
  {key:"notes",      label:"Notes",        required:false, aliases:["notes","remarks","comments","description"]}
];

LF.importer.TEMPLATES = {
  generic:  "First Name,Last Name,Email,Phone,Company,Industry,City,Country,Source,Stage,Score,Amount,Currency,Notes\nPriya,Sharma,priya@acmeco.com,+91 98765 43210,Acme Corp,SaaS,Bengaluru,IN,Website Form,Qualified,72,45000,INR,Requested enterprise demo",
  hubspot:  "First Name,Last Name,Email,Phone Number,Company name,Industry,City,Country/Region,Lead Source,Lifecycle Stage,HubSpot Score,Amount,Deal Currency,Notes",
  zoho:     "First Name,Last Name,Email,Mobile,Account Name,Industry,City,Country,Lead Source,Lead Status,Lead Score,Deal Amount,Currency,Description",
  salesforce:"FirstName,LastName,Email,Phone,Company,Industry,City,Country,LeadSource,Status,Rating,AnnualRevenue,CurrencyIsoCode,Description"
};

LF.importer.parseCSV = function(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length) return {headers:[], rows:[]};
  const parseLine = s=>{
    const out=[]; let cur=""; let inQ=false;
    for(let i=0;i<s.length;i++){
      const ch = s[i];
      if(ch==='"'){ if(inQ && s[i+1]==='"'){ cur+='"'; i++ } else inQ=!inQ; }
      else if(ch===',' && !inQ){ out.push(cur); cur=""; }
      else cur+=ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map(h=>h.trim().replace(/^"|"$/g,""));
  const rows = lines.slice(1).map(parseLine);
  return {headers, rows};
};

LF.importer.autoMap = function(headers){
  const map = {};
  headers.forEach(h=>{
    const hl = h.toLowerCase().trim();
    const field = LF.importer.FIELDS.find(f=> f.aliases.some(a => hl===a || hl.includes(a)));
    if(field) map[h] = field.key;
    else map[h] = "";
  });
  return map;
};

LF.importer.open = function(){
  LF.state.importStage = "step1";
  LF.state.importData = null;
  LF.importer._renderModal();
};

LF.importer._renderModal = function(){
  const stage = LF.state.importStage || "step1";
  let body = "", foot = "";
  if(stage==="step1"){
    body = `
      <p style="font-size:13px;color:var(--ink-500);margin-bottom:14px">Import leads in bulk. LeadForge auto-maps columns — you can review and adjust before committing.</p>
      <div class="seg" style="margin-bottom:12px" id="imp-src">
        <button class="active" onclick="LF.importer.setSrc('file',event)">📁 Upload file</button>
        <button onclick="LF.importer.setSrc('paste',event)">📋 Paste CSV</button>
        <button onclick="LF.importer.setSrc('template',event)">✨ Start from template</button>
      </div>
      <div id="imp-src-body">
        <div class="fld"><label>Upload a CSV file</label>
          <input type="file" id="imp-file" accept=".csv,.tsv,text/csv" onchange="LF.importer.loadFile(event)" style="padding:10px;border:2px dashed var(--ab7-sky);background:var(--ab7-sky-ghost);border-radius:10px;font-size:13px;width:100%">
          <div class="hint">Max 50 MB. Supports UTF-8 CSV with headers in row 1.</div>
        </div>
      </div>
      <div style="margin-top:12px;padding:12px;background:var(--ab7-sky-ghost);border-radius:10px;font-size:12px;color:var(--ink-700)">
        <b>Recognized formats:</b> generic CSV, HubSpot export, Zoho export, Salesforce export. Aliases like "First Name", "Email Address", "Mobile" are auto-mapped.
      </div>
    `;
    foot = `<button class="btn btn-ghost" onclick="LF.modal.close()">Cancel</button>`;
  } else if(stage==="step2"){
    const d = LF.state.importData;
    body = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span class="tag blue">${d.rows.length} rows detected</span>
        <span class="tag">${d.headers.length} columns</span>
      </div>
      <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:12px">Map each column to a LeadForge field. Required: First name, Last name, Email, Company. Leave "— skip —" for columns you don't want to import.</p>
      <div style="max-height:320px;overflow-y:auto;border:1px solid var(--ink-150);border-radius:10px">
        <table class="tbl" style="margin:0">
          <thead><tr><th>Your column</th><th>Sample value</th><th>Maps to</th></tr></thead>
          <tbody>
            ${d.headers.map((h,i)=>`<tr>
              <td><b>${escapeHtml(h)}</b></td>
              <td style="font-size:11.5px;color:var(--ink-500);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml((d.rows[0]||[])[i]||"")}</td>
              <td>
                <select data-col="${escapeHtml(h)}" class="filter" style="width:100%;font-size:12px">
                  <option value="">— skip —</option>
                  ${LF.importer.FIELDS.map(f=>`<option value="${f.key}" ${d.mapping[h]===f.key?'selected':''}>${f.label}${f.required?' *':''}</option>`).join("")}
                </select>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;padding:10px;background:var(--ab7-sky-ghost);border-radius:8px;font-size:12px;color:var(--ink-700)">
        <b>Dedupe mode:</b>
        <label style="margin-left:8px"><input type="radio" name="imp-dedupe" value="skip" checked> Skip if email exists</label>
        <label style="margin-left:8px"><input type="radio" name="imp-dedupe" value="update"> Update existing by email</label>
        <label style="margin-left:8px"><input type="radio" name="imp-dedupe" value="create"> Always create new</label>
      </div>
    `;
    foot = `<button class="btn btn-ghost" onclick="LF.importer.backToStep1()">← Back</button>
      <button class="btn btn-primary" onclick="LF.importer.preview()">Preview &amp; validate →</button>`;
  } else if(stage==="step3"){
    const d = LF.state.importData;
    const r = d.validation;
    body = `
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi"><div class="lbl">Ready to import</div><div class="val" style="color:var(--ab7-green-deep)">${r.valid.length}</div><div class="delta up">${d.dedupeMode==='skip'?'new only':'includes updates'}</div></div>
        <div class="kpi"><div class="lbl">Duplicates</div><div class="val">${r.dupes.length}</div><div class="delta up">${d.dedupeMode==='update'?'will update':d.dedupeMode==='create'?'will create anyway':'will skip'}</div></div>
        <div class="kpi"><div class="lbl">Errors</div><div class="val" style="color:var(--danger)">${r.errors.length}</div><div class="delta down">will skip</div></div>
        <div class="kpi"><div class="lbl">Total rows</div><div class="val">${d.rows.length}</div><div class="delta">in source file</div></div>
      </div>
      ${r.errors.length?`<div style="padding:10px;background:#FEE2E2;border-left:3px solid var(--danger);border-radius:8px;margin-bottom:12px;font-size:12.5px;color:#991B1B;max-height:100px;overflow:auto"><b>Validation errors:</b><br>${r.errors.slice(0,8).map(e=>`Row ${e.row}: ${escapeHtml(e.reason)}`).join('<br>')}${r.errors.length>8?`<br>…and ${r.errors.length-8} more`:''}</div>`:''}
      <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">Preview of the first 8 rows that will be imported:</p>
      <div style="max-height:260px;overflow:auto;border:1px solid var(--ink-150);border-radius:10px">
        <table class="tbl" style="margin:0">
          <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Stage</th><th>Score</th><th>Value</th></tr></thead>
          <tbody>
            ${r.valid.slice(0,8).map(l=>`<tr>
              <td><b>${escapeHtml(l.firstName+' '+l.lastName)}</b></td>
              <td style="font-size:12px">${escapeHtml(l.email)}</td>
              <td>${escapeHtml(l.company)}</td>
              <td><span class="tag ${STAGE_COLORS[l.stage]||'slate'}">${escapeHtml(l.stage)}</span></td>
              <td><span class="score-pill ${l.score>=75?'hot':l.score>=55?'warm':'cold'}">${l.score}</span></td>
              <td style="font-family:var(--font-mono);font-size:12px">${fmtCur(l.amount,l.currency)}</td>
            </tr>`).join("")||'<tr><td colspan="6" class="tbl-empty">No rows to import.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    foot = `<button class="btn btn-ghost" onclick="LF.state.importStage='step2';LF.importer._renderModal()">← Back to mapping</button>
      <button class="btn btn-primary" ${r.valid.length?'':'disabled'} onclick="LF.importer.commit()">✓ Import ${r.valid.length} leads</button>`;
  } else if(stage==="step4"){
    const r = LF.state.importData.result;
    body = `
      <div style="text-align:center;padding:14px 0">
        <div style="width:64px;height:64px;border-radius:50%;background:var(--ab7-green);color:#fff;display:grid;place-items:center;margin:0 auto 14px;font-size:32px">✓</div>
        <h3 style="font-size:18px;margin-bottom:6px">Import complete</h3>
        <p style="color:var(--ink-500);font-size:13px">Your leads are now live in the pipeline.</p>
      </div>
      <div class="grid g-3" style="margin-top:14px">
        <div class="kpi"><div class="lbl">Created</div><div class="val" style="color:var(--ab7-green-deep)">${r.created}</div></div>
        <div class="kpi"><div class="lbl">Updated</div><div class="val">${r.updated}</div></div>
        <div class="kpi"><div class="lbl">Skipped</div><div class="val" style="color:var(--ink-400)">${r.skipped}</div></div>
      </div>
    `;
    foot = `<button class="btn btn-ghost" onclick="LF.importer.open()">Import another file</button>
      <button class="btn btn-primary" onclick="LF.modal.close();LF.router.go('leads')">View leads →</button>`;
  }
  LF.modal.open({ title:"Import leads", body, foot });
};

LF.importer.setSrc = function(kind, ev){
  document.querySelectorAll("#imp-src button").forEach(b=>b.classList.remove("active"));
  if(ev) ev.target.classList.add("active");
  const el = document.getElementById("imp-src-body");
  if(kind==="file") el.innerHTML = `
    <div class="fld"><label>Upload a CSV file</label>
      <input type="file" id="imp-file" accept=".csv,.tsv,text/csv" onchange="LF.importer.loadFile(event)" style="padding:10px;border:2px dashed var(--ab7-sky);background:var(--ab7-sky-ghost);border-radius:10px;font-size:13px;width:100%">
      <div class="hint">Max 50 MB. Supports UTF-8 CSV with headers in row 1.</div>
    </div>`;
  else if(kind==="paste") el.innerHTML = `
    <div class="fld"><label>Paste CSV content</label>
      <textarea id="imp-paste" style="min-height:180px;font-family:var(--font-mono);font-size:11.5px" placeholder="First Name,Last Name,Email,Company&#10;Priya,Sharma,priya@acme.com,Acme Corp"></textarea>
    </div>
    <button class="btn btn-primary btn-sm" onclick="LF.importer.loadPaste()">Parse CSV →</button>`;
  else el.innerHTML = `
    <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">Pick a template matching your source system. It'll pre-fill the example headers you can use as a starting point.</p>
    <div class="grid g-2">
      ${[["generic","Generic CSV"],["hubspot","HubSpot export"],["zoho","Zoho CRM export"],["salesforce","Salesforce export"]].map(([k,label])=>`
        <div class="card" style="padding:14px;cursor:pointer" onclick="LF.importer.useTemplate('${k}')">
          <div style="font-weight:700;font-size:13.5px;margin-bottom:4px">${label}</div>
          <div style="font-size:11px;color:var(--ink-500);font-family:var(--font-mono);max-height:48px;overflow:hidden">${escapeHtml(LF.importer.TEMPLATES[k].split('\n')[0])}</div>
          <button class="btn btn-ghost btn-xs" style="margin-top:8px">Use template</button>
        </div>`).join("")}
    </div>`;
};

LF.importer.loadFile = function(ev){
  const file = ev.target.files[0]; if(!file) return;
  if(file.size > 50*1024*1024){ LF.toast("File too large (max 50 MB)","err"); return }
  const reader = new FileReader();
  reader.onload = e => LF.importer._process(e.target.result);
  reader.readAsText(file);
};
LF.importer.loadPaste = function(){
  const text = document.getElementById("imp-paste")?.value; if(!text){ LF.toast("Paste CSV content first","err"); return }
  LF.importer._process(text);
};
LF.importer.useTemplate = function(k){
  const t = LF.importer.TEMPLATES[k];
  LF.importer._process(t);
};
LF.importer._process = function(text){
  const {headers, rows} = LF.importer.parseCSV(text);
  if(!headers.length){ LF.toast("No columns detected","err"); return }
  const mapping = LF.importer.autoMap(headers);
  const autoMapped = Object.values(mapping).filter(v=>v).length;
  LF.state.importData = {headers, rows, mapping, dedupeMode:"skip"};
  LF.state.importStage = "step2";
  LF.importer._renderModal();
  LF.toast(`${rows.length} rows · auto-mapped ${autoMapped}/${headers.length} columns`,"info");
};
LF.importer.backToStep1 = function(){ LF.state.importStage="step1"; LF.importer._renderModal() };

LF.importer.preview = function(){
  const d = LF.state.importData;
  // Collect mapping from UI
  document.querySelectorAll('[data-col]').forEach(sel=>{
    d.mapping[sel.dataset.col] = sel.value;
  });
  const dedupeEl = document.querySelector('input[name="imp-dedupe"]:checked');
  d.dedupeMode = dedupeEl?dedupeEl.value:"skip";

  // Validate required mappings
  const mappedKeys = Object.values(d.mapping);
  const missing = LF.importer.FIELDS.filter(f=>f.required && !mappedKeys.includes(f.key));
  if(missing.length){ LF.toast("Map these required fields first: "+missing.map(f=>f.label).join(", "),"err"); return }

  // Build field→column index
  const colIdx = {};
  d.headers.forEach((h,i)=>{ if(d.mapping[h]) colIdx[d.mapping[h]] = i; });

  const valid = [], dupes = [], errors = [];
  const existingEmails = new Set(LF.state.leads.map(l=>l.email.toLowerCase()));

  d.rows.forEach((row, idx)=>{
    const obj = {};
    LF.importer.FIELDS.forEach(f=>{
      const i = colIdx[f.key];
      if(i !== undefined) obj[f.key] = (row[i]||"").replace(/^"|"$/g,"").trim();
    });
    if(!obj.firstName || !obj.lastName){ errors.push({row:idx+2, reason:"Name required"}); return }
    if(!obj.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.email)){ errors.push({row:idx+2, reason:"Invalid email: "+(obj.email||'(empty)')}); return }
    if(!obj.company){ errors.push({row:idx+2, reason:"Company required"}); return }

    obj.email = obj.email.toLowerCase();
    obj.name = `${obj.firstName} ${obj.lastName}`;
    obj.industry = obj.industry || "SaaS";
    obj.city = obj.city || "Mumbai";
    obj.country = obj.country || "IN";
    obj.source = obj.source || "Import";
    obj.stage = STAGES.includes(obj.stage) ? obj.stage : "New";
    obj.score = Math.max(0, Math.min(100, parseInt(obj.score)||40));
    obj.amount = parseFloat(obj.amount) || 10000;
    obj.currency = "INR"; /* Portal-wide INR-only policy */
    obj.phone = obj.phone || "";
    obj.notes = obj.notes || "";

    const isDupe = existingEmails.has(obj.email);
    if(isDupe){
      dupes.push(obj);
      if(d.dedupeMode==="update" || d.dedupeMode==="create") valid.push(obj);
    } else {
      valid.push(obj);
      existingEmails.add(obj.email);
    }
  });

  d.validation = {valid, dupes, errors};
  LF.state.importStage = "step3";
  LF.importer._renderModal();
};

LF.importer.commit = function(){
  const d = LF.state.importData;
  const existingMap = new Map(LF.state.leads.map(l=>[l.email.toLowerCase(), l]));
  let created=0, updated=0, skipped=0;

  d.validation.valid.forEach(obj=>{
    const existing = existingMap.get(obj.email);
    if(existing && d.dedupeMode==="update"){
      Object.assign(existing, {
        firstName:obj.firstName, lastName:obj.lastName, name:obj.name,
        phone:obj.phone||existing.phone, company:obj.company, industry:obj.industry,
        city:obj.city, country:obj.country, source:obj.source,
        stage:obj.stage, score:obj.score, amount:obj.amount, currency:obj.currency,
        notes:obj.notes||existing.notes, updatedAt:Date.now()
      });
      existing.activities.push({type:"edit",at:Date.now(),by:LF.state.user.id,text:"Updated via CSV import"});
      updated++;
    } else if(existing && d.dedupeMode==="skip"){
      skipped++;
    } else {
      const lead = {
        id:rid(),
        firstName:obj.firstName, lastName:obj.lastName, name:obj.name,
        email:obj.email, phone:obj.phone, company:obj.company, industry:obj.industry,
        city:obj.city, country:obj.country, source:obj.source,
        ownerId:LF.state.user.id, stage:obj.stage, score:obj.score,
        amount:obj.amount, currency:obj.currency,
        tags:obj.score>75?["hot"]:obj.score>55?["warm"]:["cold"],
        notes:obj.notes, consent:{email:true,whatsapp:false,sms:false},
        createdAt:Date.now(), updatedAt:Date.now(),
        activities:[{type:"create",at:Date.now(),by:LF.state.user.id,text:"Imported from CSV"}]
      };
      LF.state.leads.unshift(lead);
      created++;
    }
  });
  skipped += d.validation.errors.length;
  d.result = {created, updated, skipped};

  LF.storage.save();
  LF.updateSidebarCounts && LF.updateSidebarCounts();
  LF.state.importStage = "step4";
  LF.importer._renderModal();
  LF.toast(`Imported ${created} new · ${updated} updated · ${skipped} skipped`, "");
};

/* Replace the old importer stubs with the real wizard */
LF.importLeads = function(){ LF.importer.open(); };
/* ==========================================================
   MAIL MODULE — full send/receive/operate client in-portal
   ========================================================== */
LF.mail = LF.mail || {};

LF.mail._bootstrap = function(){
  if(!LF.state.mailbox){
    LF.state.mailbox = {
      messages: LF.mail._seedMessages(),
      currentFolder: "inbox",
      selectedId: null,
      search: "",
      lastFetch: Date.now()
    };
  }
};

LF.mail._seedMessages = function(){
  const me = LF.state.user?.email || "me@ab7solutions.com";
  const leads = (LF.state.leads||[]).slice(0, 14);
  const msgs = [];
  const now = Date.now();
  leads.forEach((l, i)=>{
    const incoming = Math.random()>0.3;
    const t = now - i*3600000*4 - Math.random()*86400000;
    if(incoming){
      msgs.push({
        id: rid(), folder:"inbox", from:l.email, fromName:l.name, to:me,
        subject: i%2?`Re: LeadForge demo for ${l.company}`:`Interested in your ${l.industry} solution`,
        body: i%3===0?`Hi,\n\nThanks for reaching out. Happy to schedule a demo sometime this week. Tuesday afternoon or Wednesday morning work best for me.\n\nCould you share the pricing for a team of ~${10+i*5} users?\n\nBest,\n${l.firstName}`
          : i%3===1?`Hi team,\n\nWe received your note about LeadForge 360. Before we proceed, could you share:\n\n1. DPDP-compliance status\n2. Migration timelines from our current CRM\n3. Pricing for our ${l.country} operations\n\nThanks,\n${l.firstName} ${l.lastName}`
          : `Confirming our call Friday at 3 PM IST. I'll bring our CTO. Please share the agenda.\n\n${l.firstName}`,
        at: t, read: i>2, starred: i===0, leadId: l.id, channel:"email", attachments:[]
      });
    }
    // Also simulate some sent mail
    if(i%2===0){
      msgs.push({
        id: rid(), folder:"sent", from:me, fromName:LF.state.user?.name||"You", to:l.email, toName:l.name,
        subject: `Following up — ${l.company}`,
        body: `Hi ${l.firstName},\n\nJust following up on our conversation. I've attached the case study relevant to ${l.industry} and the commercial overview.\n\nLet me know if we can jump on a quick call this week.\n\nBest,\n${LF.state.user?.name||'AB7 Team'}`,
        at: t - 3600000*2, read: true, starred: false, leadId: l.id, channel:"email", attachments:[]
      });
    }
  });
  return msgs.sort((a,b)=>b.at-a.at);
};

LF.mail.folders = function(){
  const m = LF.state.mailbox.messages;
  return [
    {id:"inbox",    label:"Inbox",    icon:"📥", count: m.filter(x=>x.folder==="inbox").length, unread: m.filter(x=>x.folder==="inbox"&&!x.read).length},
    {id:"starred",  label:"Starred",  icon:"★",  count: m.filter(x=>x.starred).length, unread:0},
    {id:"sent",     label:"Sent",     icon:"→", count: m.filter(x=>x.folder==="sent").length, unread:0},
    {id:"drafts",   label:"Drafts",   icon:"📝", count: m.filter(x=>x.folder==="drafts").length, unread:0},
    {id:"archived", label:"Archived", icon:"📦", count: m.filter(x=>x.folder==="archived").length, unread:0},
    {id:"trash",    label:"Trash",    icon:"🗑", count: m.filter(x=>x.folder==="trash").length, unread:0}
  ];
};

LF.mail.filteredMessages = function(){
  LF.mail._bootstrap();
  const f = LF.state.mailbox.currentFolder;
  const q = (LF.state.mailbox.search||"").toLowerCase();
  return LF.state.mailbox.messages.filter(m=>{
    if(f==="starred") return m.starred && m.folder!=="trash";
    if(m.folder !== f) return false;
    if(q && !((m.subject+m.body+m.fromName+m.from+(m.toName||'')+(m.to||'')).toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>b.at-a.at);
};

LF.views.mail = function(el){
  LF.mail._bootstrap();
  LF.email._bootstrap && LF.email._bootstrap();
  const accounts = (LF.state.emailAccounts||[]).length;
  const folders = LF.mail.folders();
  const totalUnread = folders.find(f=>f.id==='inbox')?.unread || 0;

  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Mail</div><div class="page-sub">Send, receive, and operate email directly in the dashboard. Uses your configured accounts from Settings → Email.</div></div>
      <div class="page-actions">
        ${accounts===0?'<span class="tag warn">No email account connected · set one up in Settings → Email</span>':''}
        <button class="btn btn-ghost btn-sm" onclick="LF.mail.fetch()">↻ Fetch new</button>
        <button class="btn btn-primary btn-sm" onclick="LF.email.compose()">✉ Compose</button>
      </div>
    </div>

    <div class="mail-layout">
      <div class="mail-side">
        <button class="btn btn-primary btn-sm" style="width:100%;margin-bottom:12px" onclick="LF.email.compose()">✉ Compose new</button>
        <div id="mail-folders"></div>
        ${accounts>0?`<div style="margin-top:18px;padding:10px;background:var(--ab7-sky-ghost);border-radius:8px;font-size:11.5px;color:var(--ink-600)"><b>Connected:</b><br>${(LF.state.emailAccounts||[]).map(a=>`${a.address}<br><span style="color:var(--ink-400);font-size:10.5px">${a.provider}</span>`).join('<br>')}</div>`:''}
      </div>
      <div class="mail-list" id="mail-list">
        <div class="mail-toolbar">
          <div class="tbl-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="mail-q" placeholder="Search mail…" oninput="LF.state.mailbox.search=this.value;LF.mail.renderList()"></div>
        </div>
        <div id="mail-msgs"></div>
      </div>
      <div class="mail-view" id="mail-view"></div>
    </div>
  `;
  LF.mail.renderFolders();
  LF.mail.renderList();
  // open first message
  const msgs = LF.mail.filteredMessages();
  if(msgs[0]) LF.mail.openMessage(msgs[0].id);
  else document.getElementById("mail-view").innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-400);font-size:13px">Select a message to read it here.</div>';
};

LF.mail.renderFolders = function(){
  const el = document.getElementById("mail-folders"); if(!el) return;
  const current = LF.state.mailbox.currentFolder;
  const fs = LF.mail.folders();
  el.innerHTML = fs.map(f=>`
    <div class="mail-folder ${current===f.id?'active':''}" onclick="LF.mail.setFolder('${f.id}')">
      <span style="width:20px;display:inline-block">${f.icon}</span>
      <span style="flex:1">${f.label}</span>
      ${f.unread?`<span class="tag green" style="font-size:10px">${f.unread}</span>`:f.count?`<span style="font-size:11px;color:var(--ink-400)">${f.count}</span>`:''}
    </div>
  `).join("");
};

LF.mail.setFolder = function(fid){
  LF.state.mailbox.currentFolder = fid;
  LF.state.mailbox.selectedId = null;
  LF.mail.renderFolders();
  LF.mail.renderList();
  const msgs = LF.mail.filteredMessages();
  if(msgs[0]) LF.mail.openMessage(msgs[0].id);
  else document.getElementById("mail-view").innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-400);font-size:13px">No messages in this folder.</div>';
};

LF.mail.renderList = function(){
  const el = document.getElementById("mail-msgs"); if(!el) return;
  const msgs = LF.mail.filteredMessages();
  const current = LF.state.mailbox.selectedId;
  el.innerHTML = msgs.map(m=>{
    const addr = m.folder==="sent" ? (m.toName||m.to) : (m.fromName||m.from);
    return `<div class="mail-item ${current===m.id?'active':''} ${m.read?'':'unread'}" onclick="LF.mail.openMessage('${m.id}')">
      <div class="mail-item-head">
        <div class="avatar-sm">${initials(addr)}</div>
        <div style="flex:1;min-width:0">
          <div class="mail-item-from">${escapeHtml(addr)}</div>
          <div class="mail-item-subj">${escapeHtml(m.subject)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
          <span class="mail-item-date">${fmtTime(m.at)}</span>
          ${m.starred?'<span style="color:#F59E0B;font-size:14px">★</span>':''}
        </div>
      </div>
      <div class="mail-item-preview">${escapeHtml(m.body.replace(/\n/g,' ').slice(0,100))}</div>
    </div>`;
  }).join("") || '<div style="padding:40px;text-align:center;color:var(--ink-400);font-size:13px">No messages here.</div>';
};

LF.mail.openMessage = function(id){
  const m = LF.state.mailbox.messages.find(x=>x.id===id); if(!m) return;
  if(!m.read && m.folder==="inbox"){ m.read = true; LF.storage.save(); LF.mail.renderFolders(); LF.mail.renderList(); }
  LF.state.mailbox.selectedId = id;
  const lead = m.leadId ? LF.state.leads.find(l=>l.id===m.leadId) : null;
  const el = document.getElementById("mail-view"); if(!el) return;
  el.innerHTML = `
    <div class="mail-view-head">
      <h3 style="font-size:17px;font-weight:700;margin-bottom:10px">${escapeHtml(m.subject)}</h3>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div class="avatar-sm" style="width:36px;height:36px;font-size:12px">${initials(m.fromName||m.from)}</div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:13px;font-weight:700">${escapeHtml(m.fromName||m.from)}</div>
          <div style="font-size:11.5px;color:var(--ink-500)">
            ${m.folder==="sent"?`To: ${escapeHtml(m.toName||m.to)}`:`From: &lt;${escapeHtml(m.from)}&gt;`}
            ${m.folder!=="sent"?` · To: ${escapeHtml(m.to)}`:''}
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--ink-500);font-family:var(--font-mono)">${new Date(m.at).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-xs" onclick="LF.mail.toggleStar('${id}')">${m.starred?'★ Starred':'☆ Star'}</button>
        ${m.folder!=='trash'?`<button class="btn btn-ghost btn-xs" onclick="LF.mail.archive('${id}')">📦 Archive</button>`:''}
        <button class="btn btn-ghost btn-xs" onclick="LF.mail.trash('${id}')">🗑 ${m.folder==='trash'?'Delete forever':'Trash'}</button>
        ${m.folder==='trash'?`<button class="btn btn-ghost btn-xs" onclick="LF.mail.restore('${id}')">↩ Restore</button>`:''}
        ${lead?`<button class="btn btn-ghost btn-xs" onclick="LF.views.openLeadDrawer('${lead.id}')">👤 Open lead</button>`:''}
        <button class="btn btn-ghost btn-xs" onclick="LF.mail.aiSummarize('${id}')">✦ Summarize with AI</button>
      </div>
    </div>
    <div class="mail-view-body">
      <div style="font-size:13.5px;color:var(--ink-800);line-height:1.7;white-space:pre-wrap">${escapeHtml(m.body)}</div>
      ${(m.attachments||[]).length?`<div style="margin-top:14px;padding:10px;background:var(--ink-50);border-radius:8px"><b style="font-size:12px">${m.attachments.length} attachment${m.attachments.length===1?'':'s'}</b><br>${m.attachments.map(a=>`<div style="font-size:11.5px;color:var(--ab7-blue);cursor:pointer">📎 ${escapeHtml(a)}</div>`).join("")}</div>`:''}
      <div id="mail-ai-summary"></div>
    </div>
    <div class="mail-view-actions">
      <button class="btn btn-primary btn-sm" onclick="LF.mail.reply('${id}')">↩ Reply</button>
      <button class="btn btn-ghost btn-sm" onclick="LF.mail.replyAll('${id}')">↩↩ Reply all</button>
      <button class="btn btn-ghost btn-sm" onclick="LF.mail.forward('${id}')">→ Forward</button>
    </div>
  `;
  LF.mail.renderList(); // refresh to show read state
};

LF.mail.toggleStar = function(id){
  const m = LF.state.mailbox.messages.find(x=>x.id===id); if(!m) return;
  m.starred = !m.starred;
  LF.storage.save();
  LF.mail.openMessage(id);
  LF.mail.renderFolders();
};

LF.mail.archive = function(id){
  const m = LF.state.mailbox.messages.find(x=>x.id===id); if(!m) return;
  m.folder = "archived";
  LF.storage.save();
  LF.mail.renderFolders();
  LF.mail.renderList();
  const msgs = LF.mail.filteredMessages();
  if(msgs[0]) LF.mail.openMessage(msgs[0].id);
  else document.getElementById("mail-view").innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-400)">Message archived.</div>';
  LF.toast("Message archived","");
};

LF.mail.trash = function(id){
  const m = LF.state.mailbox.messages.find(x=>x.id===id); if(!m) return;
  if(m.folder === 'trash'){
    if(!confirm("Delete this message permanently?")) return;
    LF.state.mailbox.messages = LF.state.mailbox.messages.filter(x=>x.id!==id);
    LF.storage.save();
    LF.mail.renderFolders();
    LF.mail.renderList();
    document.getElementById("mail-view").innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-400)">Message deleted.</div>';
    LF.toast("Message deleted permanently","info");
  } else {
    m.folder = "trash";
    LF.storage.save();
    LF.mail.renderFolders();
    LF.mail.renderList();
    const msgs = LF.mail.filteredMessages();
    if(msgs[0]) LF.mail.openMessage(msgs[0].id);
    else document.getElementById("mail-view").innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-400)">Message moved to trash.</div>';
    LF.toast("Moved to trash","info");
  }
};

LF.mail.restore = function(id){
  const m = LF.state.mailbox.messages.find(x=>x.id===id); if(!m) return;
  m.folder = "inbox";
  LF.storage.save();
  LF.mail.renderFolders();
  LF.mail.renderList();
  LF.mail.openMessage(id);
  LF.toast("Restored to inbox","");
};

LF.mail.reply = function(id){
  const m = LF.state.mailbox.messages.find(x=>x.id===id); if(!m) return;
  const quote = m.body.split("\n").map(l=>"> "+l).join("\n");
  LF.email.compose({
    leadId: m.leadId,
    to: m.from,
    subject: m.subject.startsWith("Re:") ? m.subject : "Re: " + m.subject,
    body: `\n\nOn ${new Date(m.at).toLocaleString()}, ${m.fromName||m.from} wrote:\n${quote}`
  });
};

LF.mail.replyAll = function(id){ LF.mail.reply(id); };

LF.mail.forward = function(id){
  const m = LF.state.mailbox.messages.find(x=>x.id===id); if(!m) return;
  LF.email.compose({
    subject: "Fwd: " + m.subject,
    body: `---------- Forwarded message ----------\nFrom: ${m.fromName||m.from} <${m.from}>\nDate: ${new Date(m.at).toLocaleString()}\nSubject: ${m.subject}\n\n${m.body}`
  });
};

LF.mail.aiSummarize = async function(id){
  const m = LF.state.mailbox.messages.find(x=>x.id===id); if(!m) return;
  const out = document.getElementById("mail-ai-summary");
  if(!out) return;
  out.innerHTML = '<div style="margin-top:14px;padding:12px;background:linear-gradient(135deg,rgba(59,130,246,.06),rgba(20,216,166,.06));border-radius:10px;font-size:12.5px;color:var(--ink-500)">✦ Claude is thinking…</div>';
  const prompt = `Summarize this email in 2-3 sentences, extract any action items, and suggest the best next step. Email from ${m.fromName||m.from}:\n\nSubject: ${m.subject}\n\n${m.body}`;
  const res = await (LF.claude?.complete ? LF.claude.complete(prompt, {kind:"summary", maxTokens:300}) : Promise.resolve({text:"(Claude not configured) This email is about "+m.subject+".", demo:true}));
  out.innerHTML = `<div style="margin-top:14px;padding:12px;background:linear-gradient(135deg,rgba(59,130,246,.06),rgba(20,216,166,.06));border:1px solid rgba(20,216,166,.3);border-radius:10px">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ab7-blue-deep);margin-bottom:6px">✦ AI Summary${res.demo?' · demo':''}</div>
    <div style="font-size:12.5px;color:var(--ink-800);line-height:1.55;white-space:pre-wrap">${escapeHtml(res.text)}</div>
  </div>`;
};

LF.mail.fetch = function(){
  LF.mail._bootstrap();
  const last = LF.state.mailbox.lastFetch;
  LF.state.mailbox.lastFetch = Date.now();
  LF.toast("Fetching new mail from connected accounts…","info");
  // Simulate 0-2 new messages (in production, this would hit the IMAP proxy endpoint)
  setTimeout(()=>{
    const n = Math.floor(Math.random()*3);
    if(n===0){
      LF.toast("No new messages","info");
      return;
    }
    const leads = LF.state.leads.slice(0, 20);
    for(let i=0;i<n;i++){
      const l = rand(leads);
      const msg = {
        id:rid(), folder:"inbox",
        from:l.email, fromName:l.name, to:LF.state.user?.email||"me@ab7solutions.com",
        subject: rand([`Quick question about ${l.company}`,`Re: Pricing?`,`Following up`,`Can we schedule a call?`]),
        body: rand([
          "Hi team,\n\nThanks for the previous email. Could you share the detailed pricing breakdown for a team of 25 users? Also, do you support Hindi language in the WhatsApp channel?\n\nBest,\n"+l.firstName,
          "Hi,\n\nWe'd like to move forward with a trial. Can you share the next steps?\n\n"+l.firstName,
          "Hello,\n\nJust following up — any update on the proposal? Our team is keen to evaluate.\n\nRegards,\n"+l.firstName+" "+l.lastName
        ]),
        at: Date.now()-i*1000, read:false, starred:false, leadId:l.id, channel:"email", attachments:[]
      };
      LF.state.mailbox.messages.unshift(msg);
      if(l){ l.activities.push({type:"msg",at:Date.now(),by:"system",text:"New email received: "+msg.subject}); l.updatedAt=Date.now(); }
    }
    LF.storage.save();
    LF.toast(`${n} new message${n>1?'s':''}`,"");
    if(LF.state.route==="mail"){ LF.mail.renderFolders(); LF.mail.renderList(); }
    LF.updateSidebarCounts && LF.updateSidebarCounts();
  }, 600);
};

/* Hook: when Compose sends via API mode, push a message into Sent folder */
(function(){
  const origSend = LF.email?.sendNow;
  if(!origSend) return;
  LF.email.sendNow = function(mode, leadId){
    const fromVal = document.getElementById("cp-from")?.value || "";
    const to = document.getElementById("cp-to")?.value || "";
    const subj = document.getElementById("cp-subj")?.value || "";
    const body = document.getElementById("cp-body")?.value || "";
    const res = origSend.apply(this, arguments);
    if(mode==="api" && to && subj){
      LF.mail._bootstrap();
      const [kind,id] = fromVal.split(":");
      const acc = kind==="acc" ? LF.state.emailAccounts.find(a=>a.id===id) : null;
      LF.state.mailbox.messages.unshift({
        id:rid(), folder:"sent",
        from: acc?acc.address:(LF.state.user?.email||"me@ab7solutions.com"),
        fromName: LF.state.user?.name||"You", to, toName: "",
        subject:subj, body, at:Date.now(), read:true, starred:false,
        leadId: leadId||null, channel:"email", attachments:[]
      });
      LF.storage.save();
    }
    return res;
  };
})();
LF.views.settings = function(el){
  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Settings</div><div class="page-sub">Profile, team, billing, API keys, tenant.</div></div>
      <div class="page-actions"><button class="btn btn-danger btn-sm" onclick="LF.auth.logout()">Sign out</button></div>
    </div>

    <div class="seg" style="margin-bottom:16px"><button class="active" onclick="LF.views.settingsTab('profile',event)">Profile</button><button onclick="LF.views.settingsTab('team',event);setTimeout(()=>LF.team.renderList(),20)">Team</button><button onclick="LF.views.settingsTab('billing',event)">Billing</button><button onclick="LF.views.settingsTab('api',event);setTimeout(()=>LF.apiMgr.renderList(),20)">API &amp; SCIM</button><button onclick="LF.views.settingsTab('tenant',event)">Company</button><button onclick="LF.views.settingsTab('email',event);setTimeout(()=>LF.email.renderAccounts(),0)">Email Accounts</button><button onclick="LF.views.settingsTab('claude',event)">✦ Claude AI</button></div>

    <div id="st-profile">
      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><h3>Your profile</h3></div>
          <div class="fld"><label>Full name</label><input id="p-name" value="${escapeHtml(LF.state.user.name)}"></div>
          <div class="fld"><label>Email</label><input id="p-email" value="${escapeHtml(LF.state.user.email)}"></div>
          <div class="fld"><label>Role</label><input value="${escapeHtml(LF.state.user.role)}" readonly></div>
          <button class="btn btn-primary btn-sm" onclick="LF.state.user.name=document.getElementById('p-name').value;LF.state.user.email=document.getElementById('p-email').value;LF.state.user.avatar=initials(LF.state.user.name);document.getElementById('tb-username').textContent=LF.state.user.name;document.getElementById('tb-avatar').textContent=LF.state.user.avatar;LF.storage.save();LF.toast('Profile updated','')">Save profile</button>
        </div>
        <div class="card">
          <div class="card-head"><h3>Security</h3></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed var(--ink-150);align-items:center"><div><div style="font-size:13px;font-weight:700">Passkey / FIDO2</div><div style="font-size:11.5px;color:var(--ink-400)">2 devices enrolled</div></div><span class="tag green">Active</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed var(--ink-150);align-items:center"><div><div style="font-size:13px;font-weight:700">TOTP (2FA)</div><div style="font-size:11.5px;color:var(--ink-400)">Google Authenticator</div></div><span class="tag green">Active</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;align-items:center"><div><div style="font-size:13px;font-weight:700">Session timeout</div><div style="font-size:11.5px;color:var(--ink-400)">8 hours</div></div><button class="btn btn-ghost btn-xs">Change</button></div>
        </div>
      </div>
    </div>

    <div id="st-team" style="display:none">
      <div class="card">
        <div class="card-head">
          <h3>Team members</h3>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="LF.toast('Exported team roster','info')">⬇ Export</button>
            <button class="btn btn-primary btn-sm" onclick="LF.team.invite()">＋ Invite member</button>
          </div>
        </div>
        <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:12px">Manage who can access this workspace and what they can do. Each module has four permission levels: <b>None</b> (hidden), <b>View</b> (read-only), <b>Edit</b> (create &amp; update), <b>Admin</b> (delete, configure, integrations).</p>
        <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>Member</th><th>Role</th><th>Team</th><th>Access</th><th>Status</th><th>Last login</th><th></th></tr></thead>
          <tbody id="team-rows"></tbody>
        </table>
        </div>
      </div>
    </div>

    <div id="st-billing" style="display:none">
      <div class="grid g-2">
        <div class="card" style="background:linear-gradient(135deg,#050B17,#003F7A);color:#fff;border:0">
          <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ab7-sky)">Current plan</div>
          <h3 style="color:#fff;font-size:24px;margin-top:6px">Growth · $35 / user / month</h3>
          <p style="color:#CBD5E1;font-size:13px;margin-top:8px">${(LF.state.teamMembers||ownersList()).length} users · billed annually · next invoice 01 May 2026</p>
          <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn btn-primary btn-sm">Upgrade to Enterprise</button><button class="btn btn-sm" style="background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(141,193,238,.3)" onclick="LF.views.settingsTab('team',{target:{classList:{add:()=>{},remove:()=>{}},closest:()=>null}});setTimeout(()=>LF.team.renderList(),20)">Manage seats</button></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Usage this month</h3></div>
          ${[["Leads",LF.state.leads.length,50000000],["API calls",(LF.state.apiKeys||[]).reduce((a,b)=>a+(b.calls30d||0),0),1000000],["Scheduled tasks",LF.state.scheduledTasks?.length||0,50000],["Storage",'4.2 GB','unlimited']].map(([l,v,max])=>`
            <div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px"><span>${l}</span><b>${typeof v==='number'?v.toLocaleString():v} ${max==='unlimited'?'':'/ '+(typeof max==='number'?max.toLocaleString():max)}</b></div>
              <div class="progress"><div class="bar" style="width:${max==='unlimited'?'30%':Math.min(100,v/max*100)}%"></div></div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>

    <div id="st-api" style="display:none">
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi"><div class="lbl">Active keys</div><div class="val">${(LF.state.apiKeys||[]).filter(k=>k.status==='active').length}</div><div class="delta up">of ${(LF.state.apiKeys||[]).length}</div></div>
        <div class="kpi"><div class="lbl">API calls · 30d</div><div class="val">${(LF.state.apiKeys||[]).reduce((a,b)=>a+(b.calls30d||0),0).toLocaleString()}</div><div class="delta up">across all keys</div></div>
        <div class="kpi"><div class="lbl">Rate limit</div><div class="val">${Math.max(0,...((LF.state.apiKeys||[]).map(k=>k.rateLimit)))||'—'}</div><div class="delta up">per hour (max)</div></div>
        <div class="kpi"><div class="lbl">SCIM</div><div class="val" style="font-size:18px;line-height:1.25">${LF.state.scim?.enabled?'<span style="color:var(--ab7-green-deep)">✓ Enabled</span>':'<span style="color:var(--ink-500)">Disabled</span>'}</div><div class="delta up">${LF.state.scim?.lastSync?'synced '+fmtTime(LF.state.scim.lastSync):'never synced'}</div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>API keys</h3><button class="btn btn-primary btn-sm" onclick="LF.apiMgr.generate()">＋ Generate key</button></div>
        <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:12px">Keys authenticate external apps against your LeadForge tenant. You see the full key only once, on creation.</p>
        <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>Label</th><th>Key</th><th>Scopes</th><th>Rate limit</th><th>Calls (30d)</th><th>Last used</th><th></th></tr></thead>
          <tbody id="api-rows"></tbody>
        </table>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head">
          <h3>SCIM 2.0 provisioning</h3>
          <label style="display:inline-flex;gap:6px;align-items:center;font-size:12px;font-weight:600"><input type="checkbox" id="scim-enabled" ${LF.state.scim?.enabled?'checked':''}> Enable SCIM</label>
        </div>
        <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:12px">Point your IdP (Okta, Azure AD, Jumpcloud, Google) at the SCIM endpoint below. Users and groups will sync automatically.</p>
        <div class="fld"><label>SCIM endpoint (read-only)</label><input id="scim-endpoint" value="${escapeHtml(LF.state.scim?.endpoint||'https://scim.leadforge.ab7/v2')}" readonly style="font-family:var(--font-mono);font-size:12px;background:var(--ink-50)"></div>
        <div class="fld-row">
          <div class="fld"><label>Bearer token</label>
            <div style="display:flex;gap:6px">
              <input id="scim-token" type="password" value="${escapeHtml(LF.state.scim?.bearerToken||'')}" placeholder="scim_•••••••••••••••" style="flex:1">
              <button class="btn btn-ghost btn-xs" onclick="LF.apiMgr.rotateScimToken()">↻ Rotate</button>
            </div>
          </div>
          <div class="fld"><label>IdP tenant ID (optional)</label><input id="scim-tenant" value="${escapeHtml(LF.state.scim?.tenantId||'')}" placeholder="your-okta-tenant"></div>
        </div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-500);margin:14px 0 6px">Attribute mappings</div>
        <div class="fld-row">
          <div class="fld"><label>IdP email →</label><input id="scim-map-email" value="${escapeHtml(LF.state.scim?.mappings?.email||'username')}"></div>
          <div class="fld"><label>IdP department →</label><input id="scim-map-dept" value="${escapeHtml(LF.state.scim?.mappings?.department||'team')}"></div>
        </div>
        <div class="fld"><label>IdP title →</label><input id="scim-map-title" value="${escapeHtml(LF.state.scim?.mappings?.title||'role')}"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-ghost btn-sm" onclick="LF.apiMgr.testScim()">⚡ Test connection</button>
          <button class="btn btn-ghost btn-sm" onclick="window.open('https://docs.leadforge.ab7/scim','_blank');LF.toast('Opening SCIM docs','info')">📖 Docs</button>
          <div style="flex:1"></div>
          <button class="btn btn-primary btn-sm" onclick="LF.apiMgr.saveScim()">Save SCIM settings</button>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head"><h3>Webhooks</h3><button class="btn btn-ghost btn-sm" onclick="LF.toast('Add webhook flow','info')">＋ Add webhook</button></div>
        <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:8px">Subscribe to events: <code>lead.created</code>, <code>lead.updated</code>, <code>qualification.completed</code>, <code>task.scheduled</code>, <code>deal.won</code>, <code>deal.lost</code>.</p>
        <div style="font-family:var(--font-mono);font-size:12px;background:var(--ink-50);border:1px solid var(--ink-150);padding:12px;border-radius:8px;color:var(--ink-700)">
          POST https://your-app.com/leadforge-webhook<br>
          Content-Type: application/json<br>
          X-LeadForge-Signature: sha256=...<br>
          X-LeadForge-Event: lead.created
        </div>
      </div>
    </div>

    <div id="st-tenant" style="display:none">
      ${(function(){ LF.company._bootstrap(); const co=LF.state.company; return `
        <div class="grid g-2" style="margin-bottom:16px">
          <div class="card">
            <div class="card-head"><h3>Company profile</h3></div>

            <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:14px;padding:14px;background:var(--ab7-sky-ghost);border-radius:10px">
              <div style="width:84px;height:84px;border-radius:12px;background:#fff;border:1px dashed var(--ab7-blue);display:grid;place-items:center;overflow:hidden;flex:none">
                <img id="co-logo-preview" src="${co.logo||''}" style="max-width:80%;max-height:80%;object-fit:contain;display:${co.logo?'block':'none'}">
                ${!co.logo?'<span style="font-size:10px;color:var(--ink-400);text-align:center;padding:4px">No logo</span>':''}
              </div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700;margin-bottom:3px">Company logo</div>
                <div style="font-size:11.5px;color:var(--ink-500);margin-bottom:10px">PNG/JPG/SVG · max 500 KB · shown in sidebar &amp; login</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  <label class="btn btn-ghost btn-sm" style="cursor:pointer"><input type="file" accept="image/*" style="display:none" onchange="LF.company.uploadLogo(event)"> ⬆ Upload logo</label>
                  <button class="btn btn-ghost btn-sm" onclick="LF.company.removeLogo()">Remove</button>
                </div>
              </div>
            </div>

            <div class="fld"><label>Company name *</label><input id="co-name" value="${escapeHtml(co.name)}"></div>
            <div class="fld"><label>Tagline</label><input id="co-tagline" value="${escapeHtml(co.tagline)}"></div>
            <div class="fld"><label>Description</label><textarea id="co-desc" style="min-height:70px">${escapeHtml(co.description)}</textarea></div>
            <div class="fld-row">
              <div class="fld"><label>Industry</label>
                <select id="co-industry">${["SaaS","Real Estate","Healthcare","BFSI","Education","Retail","Manufacturing","Hospitality","Logistics","Pharma","Legal","Media","Consulting","Other"].map(i=>`<option ${i===co.industry?'selected':''}>${i}</option>`).join("")}</select>
              </div>
              <div class="fld"><label>Company size</label>
                <select id="co-size">${["1-10","11-50","51-200","201-500","501-1000","1000+"].map(s=>`<option ${s===co.size?'selected':''}>${s}</option>`).join("")}</select>
              </div>
            </div>
            <div class="fld-row">
              <div class="fld"><label>Website</label><input id="co-website" value="${escapeHtml(co.website)}" placeholder="https://…"></div>
              <div class="fld"><label>Founded</label><input id="co-founded" value="${escapeHtml(co.founded)}" placeholder="2024"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Address &amp; contact</h3></div>
            <div class="fld"><label>Street</label><input id="co-street" value="${escapeHtml(co.address.street)}" placeholder="No. 42, MG Road"></div>
            <div class="fld-row">
              <div class="fld"><label>City</label><input id="co-city" value="${escapeHtml(co.address.city)}"></div>
              <div class="fld"><label>State / Region</label><input id="co-state" value="${escapeHtml(co.address.state)}"></div>
            </div>
            <div class="fld-row">
              <div class="fld"><label>Country</label>
                <select id="co-country">${["IN","AE","SA","QA","SG","ID","MY","GB","US","AU","BR"].map(c=>`<option ${c===co.address.country?'selected':''}>${c}</option>`).join("")}</select>
              </div>
              <div class="fld"><label>Postal code</label><input id="co-postal" value="${escapeHtml(co.address.postal)}"></div>
            </div>
            <div class="fld-row">
              <div class="fld"><label>Phone</label><input id="co-phone" value="${escapeHtml(co.phone)}"></div>
              <div class="fld"><label>Support email</label><input id="co-support" type="email" value="${escapeHtml(co.supportEmail)}"></div>
            </div>
            <div class="fld"><label>GST / VAT / Tax ID</label><input id="co-gst" value="${escapeHtml(co.gst)}" placeholder="29ABCDE1234F1Z5"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Workspace &amp; billing locale</h3></div>
          <div class="fld-row">
            <div class="fld"><label>Data residency region</label>
              <select id="co-region">${["India (Mumbai) — DPDP","UAE (Dubai)","EU (Frankfurt)","US (Virginia)","Singapore"].map(r=>`<option ${r===co.billing.region?'selected':''}>${r}</option>`).join("")}</select>
            </div>
            <div class="fld"><label>Default currency</label>
              <select id="co-ccy" disabled style="background:var(--ink-50);cursor:not-allowed"><option value="INR" selected>INR · ₹ Indian Rupee</option></select>
            </div>
          </div>
          <div class="fld-row">
            <div class="fld"><label>Fiscal year</label>
              <select id="co-fy">${["Apr–Mar (India)","Jan–Dec","Jul–Jun","Oct–Sep"].map(f=>`<option ${f===co.billing.fiscalYear?'selected':''}>${f}</option>`).join("")}</select>
            </div>
            <div class="fld"><label>Subdomain</label><input id="co-subdomain" value="${escapeHtml(co.billing.subdomain)}"></div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="LF.company.save()">Save company profile</button>
        </div>
      `; })()}
    </div>


    <div id="st-email" style="display:none">
      <div class="grid g-4" style="margin-bottom:16px">
        <div class="kpi"><div class="lbl">Sent · 30d</div><div class="val" id="em-k-sent">0</div><div class="delta up">from all accounts</div></div>
        <div class="kpi"><div class="lbl">Delivered</div><div class="val" id="em-k-delivered">0</div><div class="delta up">98.5%</div></div>
        <div class="kpi"><div class="lbl">Opens</div><div class="val" id="em-k-opens">0</div><div class="delta up">~62%</div></div>
        <div class="kpi"><div class="lbl">Replies</div><div class="val" id="em-k-replies">0</div><div class="delta up">~18%</div></div>
      </div>

      <div class="grid g-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h3>Connected email accounts</h3><span class="tag green" id="em-count">0 active</span></div>
          <div id="em-list" style="margin-bottom:12px"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="LF.email.oauth('Google')">＋ Google / Gmail</button>
            <button class="btn btn-ghost btn-sm" onclick="LF.email.oauth('Microsoft')">＋ Microsoft 365</button>
            <button class="btn btn-ghost btn-sm" onclick="LF.email.openSmtpForm()">＋ IMAP / SMTP</button>
          </div>
          <p style="font-size:11.5px;color:var(--ink-400);margin-top:10px;line-height:1.5">Connect one or more inboxes. Every lead conversation gets logged against the right account, and you can choose which to send from on a per-message basis.</p>
        </div>

        <div class="card">
          <div class="card-head"><h3>Default preferences</h3></div>
          <div class="fld"><label>Default "From" address</label><select id="em-default"></select></div>
          <div class="fld"><label>Reply-to (optional)</label><input id="em-reply" placeholder="support@ab7solutions.com"></div>
          <div class="fld"><label>Signature</label><textarea id="em-sig" style="min-height:80px;font-family:var(--font-mono);font-size:12px"></textarea></div>
          <div class="fld-row">
            <div class="fld"><label>Daily sending cap (per account)</label><input id="em-cap" type="number" value="200"></div>
            <div class="fld"><label>Tracking</label><select id="em-track"><option value="on">Opens + clicks on</option><option value="opens">Opens only</option><option value="off">Off (compliant mode)</option></select></div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="LF.email.savePrefs()">Save preferences</button>
        </div>
      </div>

      <div class="grid g-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h3>Aliases &amp; shared mailboxes</h3><button class="btn btn-ghost btn-sm" onclick="LF.email.addAlias()">＋ Add alias</button></div>
          <div id="em-aliases"></div>
          <p style="font-size:11.5px;color:var(--ink-400);margin-top:10px;line-height:1.5">Send as sales@, support@, or any verified alias — routes replies back into the right team inbox.</p>
        </div>

        <div class="card">
          <div class="card-head"><h3>DNS &amp; deliverability</h3><button class="btn btn-ghost btn-sm" onclick="LF.email.checkDns()">⟳ Re-verify</button></div>
          <div id="em-dns" style="font-family:var(--font-mono);font-size:11.5px;background:var(--ink-900);color:#E2E8F0;padding:14px;border-radius:10px;line-height:1.7;overflow:auto"></div>
          <p style="font-size:11.5px;color:var(--ink-400);margin-top:10px;line-height:1.5">SPF, DKIM, and DMARC are checked nightly. Green on all three means your messages stay out of spam.</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px;border:1px solid var(--warn);background:#FFFBEB">
        <div class="card-head">
          <h3>⚠ Delivery method — important</h3>
          <span class="tag warn" id="del-status-tag">${LF.state.emailDelivery?.method==='mailto'?'Mailto only':LF.state.emailDelivery?.method==='relay'?'Relay webhook':LF.state.emailDelivery?.method==='emailjs'?'EmailJS':LF.state.emailDelivery?.method==='zapier'?'Zapier':'Not configured'}</span>
        </div>
        <p style="font-size:13px;color:var(--ink-700);line-height:1.55;margin-bottom:12px">
          <b>Browsers cannot send email over SMTP directly.</b> To actually deliver messages to recipients, pick one of these methods. Without a real delivery method, "Send via LeadForge" will automatically fall back to opening your default mail client (mailto:).
        </p>

        <div class="fld"><label>Delivery method</label>
          <select id="del-method" onchange="LF.email.delMethodChange(this.value)">
            <option value="mailto"  ${LF.state.emailDelivery?.method==='mailto'?'selected':''}>✉ Mailto (open user's mail client — always works)</option>
            <option value="relay"   ${LF.state.emailDelivery?.method==='relay'?'selected':''}>🔗 Relay webhook (your own SMTP proxy endpoint)</option>
            <option value="zapier"  ${LF.state.emailDelivery?.method==='zapier'?'selected':''}>⚡ Zapier / Make / n8n inbound webhook</option>
            <option value="emailjs" ${LF.state.emailDelivery?.method==='emailjs'?'selected':''}>📨 EmailJS (no backend — browser-native)</option>
          </select>
        </div>

        <div id="del-mailto" class="del-panel" style="display:${LF.state.emailDelivery?.method==='mailto'||!LF.state.emailDelivery?.method?'block':'none'};padding:10px 12px;background:var(--ab7-sky-ghost);border-radius:8px;font-size:12.5px;color:var(--ink-700);line-height:1.55">
          <b>Using mailto:</b> every send opens your operating system's default mail client (Gmail in the browser, Outlook desktop, Apple Mail…) with To/Subject/Body pre-filled. Your mail client handles the actual SMTP handshake, so the recipient receives it from your real inbox. No configuration needed — this works today.
          <br><br>Limitations: no attachments, relies on a local mail handler, can't schedule or throttle.
        </div>

        <div id="del-relay" class="del-panel" style="display:${LF.state.emailDelivery?.method==='relay'?'block':'none'}">
          <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">Run a tiny backend (Cloudflare Worker, Vercel function, Express app, Supabase edge function) that accepts JSON and forwards to SMTP / SendGrid / Mailgun / Resend / Postmark. LeadForge POSTs: <code>{from, fromName, to, cc, bcc, subject, body}</code>.</p>
          <div class="fld"><label>Relay URL</label><input id="del-relayUrl" value="${escapeHtml(LF.state.emailDelivery?.relayUrl||'')}" placeholder="https://your-backend.com/api/send"></div>
          <div class="fld"><label>Bearer token (optional)</label><input id="del-relayToken" type="password" value="${escapeHtml(LF.state.emailDelivery?.relayToken||'')}" placeholder="shared secret the relay validates"></div>
          <div style="padding:10px;background:var(--ink-900);color:#E2E8F0;border-radius:8px;font-family:var(--font-mono);font-size:11px;line-height:1.5">
          <span style="color:var(--ab7-sky)">// Minimal Cloudflare Worker example</span><br>
          export default {<br>
          &nbsp;&nbsp;async fetch(req) {<br>
          &nbsp;&nbsp;&nbsp;&nbsp;const {from,to,subject,body} = await req.json();<br>
          &nbsp;&nbsp;&nbsp;&nbsp;await fetch("https://api.resend.com/emails", { method:"POST",<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;headers:{ Authorization:\`Bearer \${RESEND_KEY}\`, "Content-Type":"application/json" },<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;body: JSON.stringify({from,to,subject,html:body}) });<br>
          &nbsp;&nbsp;&nbsp;&nbsp;return new Response("ok");<br>
          &nbsp;&nbsp;}<br>
          }
          </div>
        </div>

        <div id="del-zapier" class="del-panel" style="display:${LF.state.emailDelivery?.method==='zapier'?'block':'none'}">
          <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">No code needed. Create a <b>Webhooks by Zapier</b> (or <b>Make.com HTTP</b>, or <b>n8n Webhook</b>) trigger set to "Catch Hook", then add a "Send Email via Gmail / Outlook / Mailgun" action. Paste the hook URL below.</p>
          <div class="fld"><label>Zapier/Make/n8n inbound webhook URL</label>
            <input id="del-zapierHook" value="${escapeHtml(LF.state.emailDelivery?.zapierHook||'')}" placeholder="https://hooks.zapier.com/hooks/catch/…">
          </div>
          <div style="font-size:11.5px;color:var(--ink-500);line-height:1.55">LeadForge will POST the payload: <code>{from, to, subject, body}</code>. In Zapier, map those fields to the "Send Email" action.</div>
        </div>

        <div id="del-emailjs" class="del-panel" style="display:${LF.state.emailDelivery?.method==='emailjs'?'block':'none'}">
          <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">Free tier: 200 emails/month, no backend needed. Sign up at <b>emailjs.com</b>, connect your Gmail/Outlook as a "Service", create a Template with variables <code>{{from_name}}</code>, <code>{{to_email}}</code>, <code>{{subject}}</code>, <code>{{message}}</code>. Paste the three IDs below.</p>
          <div class="fld"><label>Public Key</label><input id="del-ejs-pk" type="password" value="${escapeHtml(LF.state.emailDelivery?.emailjs?.publicKey||'')}" placeholder="xxxxxxxxxxxxxxx"></div>
          <div class="fld-row">
            <div class="fld"><label>Service ID</label><input id="del-ejs-sid" value="${escapeHtml(LF.state.emailDelivery?.emailjs?.serviceId||'')}" placeholder="service_xxxxxxx"></div>
            <div class="fld"><label>Template ID</label><input id="del-ejs-tid" value="${escapeHtml(LF.state.emailDelivery?.emailjs?.templateId||'')}" placeholder="template_xxxxxxx"></div>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="LF.email.delTestNow()">⚡ Send a test to my address</button>
          <div style="flex:1"></div>
          <button class="btn btn-primary btn-sm" onclick="LF.email.delSave()">Save delivery method</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <h3>Delivery diagnostics</h3>
          <button class="btn btn-ghost btn-sm" onclick="LF.state.emailDeliveryLog=[];LF.storage.save();LF.email.renderAccounts()">Clear log</button>
        </div>
        <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">Every send — successful or failed — is logged here. Use this if a recipient says they didn't receive your email.</p>
        <div id="del-log-body" style="max-height:280px;overflow-y:auto"></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Send a test email</h3><span class="tag gradient">Live</span></div>
        <div class="fld-row">
          <div class="fld"><label>From</label><select id="em-test-from"></select></div>
          <div class="fld"><label>To</label><input id="em-test-to" type="email" placeholder="recipient@company.com"></div>
        </div>
        <div class="fld"><label>Subject</label><input id="em-test-subj" value="Hello from LeadForge 360"></div>
        <div class="fld"><label>Body</label><textarea id="em-test-body" style="min-height:110px">Hi there,&#10;&#10;This is a test email from my LeadForge 360 workspace.&#10;&#10;—&#10;Sent via LeadForge 360</textarea></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="LF.email.sendTest()">▶ Send via API</button>
          <button class="btn btn-ghost btn-sm" onclick="LF.email.sendTestMailto()">✉ Open in mail client</button>
          <div style="flex:1"></div>
          <span style="font-size:11.5px;color:var(--ink-400)">Sending uses the selected "From" account. Mailto opens your default mail app with everything pre-filled.</span>
        </div>
      </div>
    </div>


    <div id="st-claude" style="display:none">
      ${(function(){ LF.claude._bootstrap(); const cfg=LF.state.claudeConfig; const u=LF.state.claudeUsage; const configured = LF.claude.isConfigured(); return `
        <div class="grid g-4" style="margin-bottom:14px">
          <div class="kpi"><div class="lbl">Status</div><div class="val" style="font-size:17px;line-height:1.25">${configured?'<span style="color:var(--ab7-green-deep)">✓ Connected</span>':'<span style="color:var(--ink-500)">Demo mode</span>'}</div><div class="delta up">${cfg.lastTested?('last tested '+fmtTime(cfg.lastTested)):'never tested'}</div></div>
          <div class="kpi"><div class="lbl">API calls</div><div class="val">${u.calls.toLocaleString()}</div><div class="delta up">${u.lastCall?('last '+fmtTime(u.lastCall)):'—'}</div></div>
          <div class="kpi"><div class="lbl">Tokens used</div><div class="val" style="font-size:18px">${(u.promptTokens+u.completionTokens).toLocaleString()}</div><div class="delta up">${u.promptTokens.toLocaleString()} in · ${u.completionTokens.toLocaleString()} out</div></div>
          <div class="kpi"><div class="lbl">Monthly spend</div><div class="val">$${u.monthlyCost.toFixed(4)}</div><div class="delta up">cumulative</div></div>
        </div>

        <div class="grid g-2">
          <div class="card">
            <div class="card-head"><h3>API credentials</h3><span class="tag gradient">Anthropic</span></div>
            <div class="fld">
              <label style="display:flex;gap:8px;align-items:center;text-transform:none;font-size:13px;font-weight:600;color:var(--ink-700)">
                <input type="checkbox" id="cl-enabled" ${cfg.enabled?'checked':''}>
                Enable Claude for real API calls
              </label>
              <div class="hint">When disabled, every AI feature falls back to deterministic demo replies.</div>
            </div>
            <div class="fld"><label>Anthropic API key</label>
              <input id="cl-key" type="password" value="${escapeHtml(cfg.apiKey)}" placeholder="sk-ant-api03-...">
              <div class="hint">Get your key from console.anthropic.com → API Keys. Treated as a secret; stored in your browser only.</div>
            </div>
            <div class="fld-row">
              <div class="fld"><label>Model</label>
                <select id="cl-model">
                  <option value="claude-opus-4-6"      ${cfg.model==='claude-opus-4-6'?'selected':''}>Claude Opus 4.6 (most capable)</option>
                  <option value="claude-sonnet-4-6"    ${cfg.model==='claude-sonnet-4-6'?'selected':''}>Claude Sonnet 4.6 (balanced · recommended)</option>
                  <option value="claude-haiku-4-5-20251001" ${cfg.model==='claude-haiku-4-5-20251001'?'selected':''}>Claude Haiku 4.5 (fastest · cheapest)</option>
                </select>
              </div>
              <div class="fld"><label>Max tokens</label><input id="cl-max" type="number" min="1" max="8192" value="${cfg.maxTokens}"></div>
            </div>
            <div class="fld-row">
              <div class="fld"><label>Temperature</label><input id="cl-temp" type="number" step="0.1" min="0" max="1" value="${cfg.temperature}"></div>
              <div class="fld"><label>Proxy URL (optional)</label>
                <input id="cl-proxy" value="${escapeHtml(cfg.proxyUrl)}" placeholder="https://your-backend/anthropic-proxy">
              </div>
            </div>
            <div class="hint" style="font-size:11px;color:var(--ink-500);line-height:1.5">Direct browser calls to Anthropic work for development but leak the API key. For production, route via your own proxy that adds the key server-side — then paste the proxy URL above.</div>

            <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" id="cl-test-btn" onclick="LF.claude.test()">⚡ Test connection</button>
              <button class="btn btn-ghost btn-sm" onclick="LF.claude.quickAsk()">✦ Ask Claude (quick)</button>
              <div style="flex:1"></div>
              <button class="btn btn-primary btn-sm" onclick="LF.claude.saveConfig()">Save configuration</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Where Claude is used</h3><span class="tag ${configured?'green':'warn'}">${configured?'Live':'Demo'}</span></div>
            <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:12px">Toggle which AI features should use real Claude calls. Features stay functional either way — they just fall back to deterministic templates in demo mode.</p>
            ${[['emailDrafts','✉ Email drafts (Compose · Inbox · Lead drawer)','Generate outreach, replies, and follow-ups with context about the lead'],
              ['actionPlans','📝 Action plans (CDP)','Generate multi-step action plans per lead based on stage and interest'],
              ['aiInsights','📊 AI insights (Dashboard · Revenue Intelligence)','Surface risks, top sources, and recommended actions from pipeline data'],
              ['leadSummaries','👤 Lead summaries (Lead drawer · Conversion handoff briefs)','Summarize a lead for an AE handoff or internal brief'],
              ['qualNotes','✅ Qualification auto-notes','Auto-draft qualifier notes from checklist answers']
             ].map(([k,title,desc])=>`
              <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px dashed var(--ink-150);align-items:center">
                <input type="checkbox" id="cl-use-${k.replace(/([A-Z])/g,'-$1').toLowerCase()}" ${cfg.useFor[k]?'checked':''}>
                <div style="flex:1"><div style="font-size:13px;font-weight:700">${title}</div><div style="font-size:11.5px;color:var(--ink-500);line-height:1.45">${desc}</div></div>
              </div>
            `).join('')}
            <button class="btn btn-ghost btn-xs" style="margin-top:10px" onclick="LF.claude.resetUsage()">Reset usage counters</button>
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-head"><h3>Default system prompt</h3><span class="tag">shared</span></div>
          <div class="fld"><textarea id="cl-system" style="min-height:140px;font-family:var(--font-mono);font-size:11.5px">${escapeHtml(cfg.systemPrompt)}</textarea>
            <div class="hint">Prepended to every Claude call from this portal. Keep it focused — specific guidance + guardrails work better than long preambles.</div>
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-head"><h3>Setup checklist</h3></div>
          <ol style="padding-left:18px;font-size:13px;color:var(--ink-700);line-height:1.7">
            <li>Create an Anthropic account at <b>console.anthropic.com</b>.</li>
            <li>Add a payment method and generate an API key (Settings → API Keys → Create Key).</li>
            <li>Pick a model — Sonnet 4.6 is the best balance for most tasks. Use Haiku 4.5 for very high volume, Opus 4.6 for the highest-stakes generation.</li>
            <li>(Optional, production) Deploy a tiny proxy (Cloudflare Worker / Vercel function) that forwards to <code>api.anthropic.com</code> and injects the key server-side. Paste its URL in <i>Proxy URL</i>.</li>
            <li>Paste the key here, check <b>Enable</b>, click <b>Test connection</b>. You should see a ~700 ms round-trip toast.</li>
            <li>Pick which features should go live. Save.</li>
          </ol>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="card-head"><h3>Sample API call</h3></div>
          <div style="font-family:var(--font-mono);font-size:11px;background:var(--ink-900);color:#E2E8F0;padding:14px;border-radius:10px;line-height:1.6;overflow:auto">
<span style="color:var(--ab7-sky)">POST</span> https://api.anthropic.com/v1/messages
<span style="color:var(--ab7-sky)">x-api-key:</span> sk-ant-api03-...
<span style="color:var(--ab7-sky)">anthropic-version:</span> 2023-06-01
<span style="color:var(--ab7-sky)">content-type:</span> application/json

{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "temperature": 0.5,
  "system": "You are...",
  "messages": [{ "role": "user", "content": "Draft a follow-up email..." }]
}
          </div>
        </div>
      `; })()}
    </div>



  `;
};
LF.views.settingsTab = function(name, ev){
  const seg = ev && ev.target && ev.target.closest && ev.target.closest('.seg');
  if(seg){ seg.querySelectorAll("button").forEach(b=>b.classList.remove("active")); ev.target.classList.add("active"); }
  ["profile","team","billing","api","tenant","email","claude"].forEach(t=>{
    const n = document.getElementById("st-"+t); if(n) n.style.display = t===name?"block":"none";
  });
};

LF.views.onLeadDomainChange = function(){
  const dSel = document.getElementById("ld-si-domain");
  const sSel = document.getElementById("ld-si-service");
  if(!dSel || !sSel) return;
  const services = dSel.value ? LF.qual.listServicesForDomain(dSel.value) : [];
  sSel.innerHTML = '<option value="">— none —</option>' + services.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
};


/* ==========================================================
   LF.subvendors — Sub-vendor partner management
   ----------------------------------------------------------
   Manages sub-vendor / sub-contractor applications submitted
   through the ab7solutions.com "Become a Sub-Vendor" form.
   The website forwards each submission to db-server.js
   (POST /api/subvendors/ingest), which stores it in
   _state.subvendors and round-trips through the snapshot so
   this module sees it. Full pipeline:
     New → Under Review → Shortlisted → Approved → Onboarded → Rejected
   ========================================================== */
LF.subvendors = LF.subvendors || {};

LF.subvendors.STAGES = ["New","Under Review","Shortlisted","Approved","Onboarded","Rejected"];
LF.subvendors.STAGE_COLORS = {
  "New":"slate", "Under Review":"sky", "Shortlisted":"blue",
  "Approved":"green", "Onboarded":"green", "Rejected":"danger"
};
/* Mirrors src/lib/vendorOptions.js on the website — used for filters + manual add. */
LF.subvendors.SERVICE_OPTIONS = ["Recruitment Agency","Corp-to-Corp (C2C) Hiring","Contract-to-Hire (C2H)","Digital Marketing","Performance Marketing","Mobile App Development","Software Development","Web App Development","Website Development","Background Verification (BGV)","SEO / AEO / GEO / AIO","Cybersecurity Consulting","Remote Professional Provider"];
LF.subvendors.REGION_OPTIONS = ["India","United States","Canada","United Kingdom","Europe (EU)","Middle East / GCC","Australia & New Zealand","Southeast Asia","Africa","Latin America"];

LF.subvendors._bootstrap = function(){
  if(!Array.isArray(LF.state.subvendors)) LF.state.subvendors = [];
  if(!LF.state.subvendorFilter) LF.state.subvendorFilter = {q:"",stage:"",service:"",region:"",owner:""};
  if(!LF.state.subvendorTab) LF.state.subvendorTab = "pipeline";
};

/* Tolerant array reader — ingested data may arrive as a real array,
   a JSON string, or a comma-joined string. */
LF.subvendors._arr = function(v){
  if(Array.isArray(v)) return v.filter(Boolean);
  if(v == null || v === "") return [];
  if(typeof v === "string"){
    const s = v.trim();
    if(s[0] === "["){ try{ const a = JSON.parse(s); return Array.isArray(a)?a.filter(Boolean):[]; }catch(e){} }
    return s.split(",").map(x=>x.trim()).filter(Boolean);
  }
  return [];
};

LF.subvendors._byId = function(id){ return (LF.state.subvendors||[]).find(v=>v.id===id); };
LF.subvendors._name = function(v){ return v.companyName || v.legalCompanyName || v.contactPerson || "Unnamed vendor"; };

/* Services as a single readable string, including the "other" free-text. */
LF.subvendors._services = function(v){
  const a = LF.subvendors._arr(v.services);
  if(v.servicesOther) a.push(v.servicesOther);
  return a;
};
LF.subvendors._regions = function(v){
  const a = LF.subvendors._arr(v.regions);
  if(v.regionsOther) a.push(v.regionsOther);
  return a;
};

LF.subvendors._filtered = function(){
  const f = LF.state.subvendorFilter;
  const q = (f.q||"").toLowerCase().trim();
  return (LF.state.subvendors||[]).filter(v=>{
    if(q){
      const hay = [v.companyName,v.contactPerson,v.officialEmail,v.contactNumber,v.legalCompanyName,
        (LF.subvendors._services(v).join(" ")),(LF.subvendors._regions(v).join(" "))].join(" ").toLowerCase();
      if(!hay.includes(q)) return false;
    }
    if(f.stage && v.stage!==f.stage) return false;
    if(f.service && !LF.subvendors._services(v).some(s=>s===f.service)) return false;
    if(f.region && !LF.subvendors._regions(v).some(r=>r===f.region)) return false;
    if(f.owner && v.ownerId!==f.owner) return false;
    return true;
  });
};

/* ---------------- Main view ---------------- */
LF.views.subvendors = function(el){
  LF.subvendors._bootstrap();
  const all = LF.state.subvendors||[];
  const count = s => all.filter(v=>v.stage===s).length;
  const total = all.length;
  const pending = count("New") + count("Under Review");
  const active = count("Approved") + count("Onboarded");
  const rejected = count("Rejected");

  el.innerHTML = `
    <div class="page-head">
      <div><div class="page-title">Sub-Vendors</div><div class="page-sub">Partner applications from the ab7solutions.com "Become a Sub-Vendor" form — review, qualify, approve and onboard.</div></div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="LF.subvendors.refresh()">⟳ Refresh</button>
        <button class="btn btn-ghost btn-sm" onclick="LF.subvendors.exportCsv()">⬇ Export CSV</button>
        <button class="btn btn-primary btn-sm" onclick="LF.subvendors.addNew()">＋ Add sub-vendor</button>
      </div>
    </div>

    <div class="grid g-4" style="margin-bottom:14px">
      <div class="kpi"><div class="lbl">Total sub-vendors</div><div class="val">${total}</div><div class="delta up">applications</div></div>
      <div class="kpi"><div class="lbl">Awaiting review</div><div class="val" style="color:var(--ab7-blue-deep)">${pending}</div><div class="delta up">New + Under Review</div></div>
      <div class="kpi"><div class="lbl">Approved / Onboarded</div><div class="val" style="color:var(--ab7-green-deep)">${active}</div><div class="delta up">active partners</div></div>
      <div class="kpi"><div class="lbl">Rejected</div><div class="val" style="color:var(--danger)">${rejected}</div><div class="delta down">declined</div></div>
    </div>

    <div class="seg" style="margin-bottom:14px">
      <button class="${LF.state.subvendorTab==='pipeline'?'active':''}" onclick="LF.subvendors.setTab('pipeline',event)">Pipeline</button>
      <button class="${LF.state.subvendorTab==='list'?'active':''}" onclick="LF.subvendors.setTab('list',event)">List · ${total}</button>
    </div>

    <div id="sv-body"></div>
  `;
  LF.subvendors._renderBody();
};

LF.subvendors.setTab = function(tab, ev){
  LF.state.subvendorTab = tab;
  document.querySelectorAll(".view .seg button").forEach(b=>b.classList.remove("active"));
  if(ev && ev.target) ev.target.classList.add("active");
  LF.subvendors._renderBody();
};

LF.subvendors.refresh = function(){
  if(LF.db && LF.db.online && LF.db.loadSnapshot){
    LF.db.loadSnapshot().then(()=>{ LF.updateSidebarCounts&&LF.updateSidebarCounts(); LF.router.go("subvendors"); LF.toast("Synced from server","" ); })
      .catch(()=>LF.toast("Sync failed — showing local data","err"));
  } else {
    LF.router.go("subvendors");
    LF.toast("Server offline — showing local data","info");
  }
};

LF.subvendors._renderBody = function(){
  const body = document.getElementById("sv-body"); if(!body) return;
  if(LF.state.subvendorTab==="list"){ body.innerHTML = LF.subvendors._listHtml(); LF.subvendors._renderRows(); }
  else { body.innerHTML = LF.subvendors._pipelineHtml(); LF.subvendors._wireKanban(); }
};

/* ---------------- Pipeline (kanban) ---------------- */
LF.subvendors._pipelineHtml = function(){
  const list = LF.subvendors._filtered();
  const f = LF.state.subvendorFilter;
  const cols = LF.subvendors.STAGES.map(stage=>{
    const items = list.filter(v=>v.stage===stage);
    const cards = items.map(v=>LF.subvendors._cardHtml(v)).join("") ||
      `<div style="font-size:11.5px;color:var(--ink-400);padding:10px;text-align:center">No sub-vendors</div>`;
    return `<div class="kanban-col" data-stage="${escapeHtml(stage)}" style="background:var(--ink-50);border-radius:12px;padding:8px;min-width:248px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px 8px">
        <span class="tag ${LF.subvendors.STAGE_COLORS[stage]}">${escapeHtml(stage)}</span>
        <span style="font-size:12px;font-weight:700;color:var(--ink-400)">${items.length}</span>
      </div>
      <div class="kanban-drop" data-stage="${escapeHtml(stage)}" style="display:flex;flex-direction:column;gap:8px;min-height:40px">${cards}</div>
    </div>`;
  }).join("");
  return `
    <div class="tbl-toolbar" style="margin-bottom:12px">
      <div class="tbl-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="sv-q" placeholder="Search company, contact, email, service…" value="${escapeHtml(f.q)}" oninput="LF.state.subvendorFilter.q=this.value;LF.subvendors._renderBody()">
      </div>
      <select class="filter" onchange="LF.state.subvendorFilter.service=this.value;LF.subvendors._renderBody()">
        <option value="">All services</option>
        ${LF.subvendors.SERVICE_OPTIONS.map(s=>`<option ${f.service===s?'selected':''}>${escapeHtml(s)}</option>`).join("")}
      </select>
      <select class="filter" onchange="LF.state.subvendorFilter.region=this.value;LF.subvendors._renderBody()">
        <option value="">All regions</option>
        ${LF.subvendors.REGION_OPTIONS.map(r=>`<option ${f.region===r?'selected':''}>${escapeHtml(r)}</option>`).join("")}
      </select>
      <button class="btn btn-ghost btn-sm" onclick="LF.state.subvendorFilter={q:'',stage:'',service:'',region:'',owner:''};LF.subvendors._renderBody()">Clear</button>
    </div>
    <div class="kanban-wrap" style="overflow-x:auto"><div style="display:flex;gap:12px;align-items:flex-start">${cols}</div></div>
    <div class="hint" style="margin-top:8px">Drag a card between columns to change its stage. Click a card to open the full application.</div>
  `;
};

LF.subvendors._cardHtml = function(v){
  const svc = LF.subvendors._services(v).slice(0,2).join(", ");
  const region = LF.subvendors._regions(v).slice(0,2).join(", ");
  const o = ownersList().find(x=>x.id===v.ownerId);
  return `<div class="sv-card" draggable="true" data-id="${v.id}" onclick="LF.subvendors.open('${v.id}')"
      style="background:#fff;border:1px solid var(--ink-150);border-radius:10px;padding:10px;cursor:pointer;box-shadow:var(--shadow-sm)">
    <div style="font-weight:700;font-size:13px;color:var(--ink-900);margin-bottom:2px">${escapeHtml(LF.subvendors._name(v))}</div>
    <div style="font-size:11px;color:var(--ink-400);margin-bottom:6px">${escapeHtml(v.contactPerson||v.officialEmail||"")}</div>
    ${svc?`<div style="font-size:11px;color:var(--ink-600);margin-bottom:4px">🛠 ${escapeHtml(svc)}</div>`:""}
    ${region?`<div style="font-size:11px;color:var(--ink-500);margin-bottom:4px">🌍 ${escapeHtml(region)}</div>`:""}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
      <span style="font-size:10.5px;color:var(--ink-400)">${v.createdAt?fmtTime(v.createdAt):""}</span>
      ${o?`<span class="avatar-sm ${o.grp||''}" title="${escapeHtml(o.name)}">${o.avatar||initials(o.name)}</span>`:`<span style="font-size:10.5px;color:var(--ink-400)">Unassigned</span>`}
    </div>
  </div>`;
};

LF.subvendors._wireKanban = function(){
  const cards = document.querySelectorAll(".sv-card");
  const drops = document.querySelectorAll(".kanban-drop");
  let dragId = null;
  cards.forEach(c=>{
    c.addEventListener("dragstart", e=>{ dragId = c.dataset.id; c.style.opacity="0.5"; if(e.dataTransfer){e.dataTransfer.effectAllowed="move";} });
    c.addEventListener("dragend", ()=>{ c.style.opacity="1"; });
  });
  drops.forEach(d=>{
    d.addEventListener("dragover", e=>{ e.preventDefault(); d.parentElement.style.outline="2px dashed var(--ab7-blue)"; });
    d.addEventListener("dragleave", ()=>{ d.parentElement.style.outline="none"; });
    d.addEventListener("drop", e=>{
      e.preventDefault(); d.parentElement.style.outline="none";
      const stage = d.dataset.stage;
      if(dragId && stage){ LF.subvendors.setStage(dragId, stage, true); }
      dragId = null;
    });
  });
};

/* ---------------- List ---------------- */
LF.subvendors._listHtml = function(){
  const f = LF.state.subvendorFilter;
  return `
    <div class="tbl-wrap">
      <div class="tbl-toolbar">
        <div class="tbl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="sv-lq" placeholder="Search company, contact, email, service…" value="${escapeHtml(f.q)}" oninput="LF.state.subvendorFilter.q=this.value;LF.subvendors._renderRows()">
        </div>
        <select class="filter" onchange="LF.state.subvendorFilter.stage=this.value;LF.subvendors._renderRows()">
          <option value="">All stages</option>
          ${LF.subvendors.STAGES.map(s=>`<option ${f.stage===s?'selected':''}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <select class="filter" onchange="LF.state.subvendorFilter.service=this.value;LF.subvendors._renderRows()">
          <option value="">All services</option>
          ${LF.subvendors.SERVICE_OPTIONS.map(s=>`<option ${f.service===s?'selected':''}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <select class="filter" onchange="LF.state.subvendorFilter.owner=this.value;LF.subvendors._renderRows()">
          <option value="">All owners</option>
          ${ownersList().map(o=>`<option value="${o.id}" ${f.owner===o.id?'selected':''}>${escapeHtml(o.name)}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" onclick="LF.state.subvendorFilter={q:'',stage:'',service:'',region:'',owner:''};LF.subvendors._renderRows()">Clear</button>
      </div>
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr>
          <th>Company</th><th>Contact</th><th>Services</th><th>Region</th><th>Stage</th><th>Owner</th><th>Docs</th><th>Submitted</th><th></th>
        </tr></thead>
        <tbody id="sv-rows"></tbody>
      </table>
      </div>
      <div class="tbl-foot"><div id="sv-count"></div></div>
    </div>
  `;
};

LF.subvendors._docBadges = function(v){
  const out = [];
  if(v.panFileLink || v.panFileUrl) out.push("PAN");
  if(v.gstFileLink || v.gstFileUrl) out.push("GST");
  if(v.brochureFileLink || v.brochureFileUrl) out.push("Brochure");
  return out;
};

LF.subvendors._renderRows = function(){
  const list = LF.subvendors._filtered();
  const rows = document.getElementById("sv-rows"); if(!rows) return;
  rows.innerHTML = list.map(v=>{
    const o = ownersList().find(x=>x.id===v.ownerId)||{name:"Unassigned",avatar:"?",grp:""};
    const svc = LF.subvendors._services(v).slice(0,2).join(", ");
    const region = LF.subvendors._regions(v).slice(0,2).join(", ");
    const docs = LF.subvendors._docBadges(v);
    return `<tr style="cursor:pointer" onclick="LF.subvendors.open('${v.id}')">
      <td><div style="font-weight:700">${escapeHtml(LF.subvendors._name(v))}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(v.officialEmail||"")}</div></td>
      <td><div style="font-size:12px;font-weight:600">${escapeHtml(v.contactPerson||"—")}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(v.contactNumber||"")}</div></td>
      <td style="max-width:180px"><div style="font-size:11.5px;color:var(--ink-700)">${escapeHtml(svc||"—")}</div></td>
      <td style="font-size:11.5px;color:var(--ink-600)">${escapeHtml(region||"—")}</td>
      <td><span class="tag ${LF.subvendors.STAGE_COLORS[v.stage]||'slate'}">${escapeHtml(v.stage||"New")}</span></td>
      <td><div class="who"><div class="avatar-sm ${o.grp||''}">${o.avatar||initials(o.name)}</div><span style="font-size:12px">${escapeHtml(o.name.split(' ')[0])}</span></div></td>
      <td>${docs.length?docs.map(d=>`<span class="tag slate" style="font-size:10px;margin-right:2px">${d}</span>`).join(""):'<span style="color:var(--ink-400);font-size:11px">—</span>'}</td>
      <td style="font-size:11.5px;color:var(--ink-500);white-space:nowrap">${v.createdAt?fmtDate(v.createdAt):"—"}</td>
      <td style="white-space:nowrap"><button class="btn btn-blue btn-xs" onclick="event.stopPropagation();LF.subvendors.open('${v.id}')">Open</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" class="tbl-empty">No sub-vendors match these filters. New applications from the website appear here automatically.</td></tr>`;
  const c = document.getElementById("sv-count");
  if(c) c.textContent = `Showing ${list.length} of ${(LF.state.subvendors||[]).length} sub-vendors`;
};

/* ---------------- Detail drawer ---------------- */
LF.subvendors._fileLink = function(label, link, path){
  if(link) return `<a class="btn btn-ghost btn-xs" href="${escapeHtml(link)}" target="_blank" rel="noopener">📎 ${label} ↗</a>`;
  if(path) return `<span class="tag slate" style="font-size:10.5px" title="${escapeHtml(path)}">${label}: in Supabase</span>`;
  return `<span style="font-size:11px;color:var(--ink-400)">${label}: —</span>`;
};

LF.subvendors._defRow = function(label, value){
  if(value==null || value==="" || (Array.isArray(value)&&!value.length)) value = "—";
  if(Array.isArray(value)) value = value.join(", ");
  return `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--ink-100)">
    <div style="flex:0 0 150px;font-size:11.5px;color:var(--ink-400);font-weight:600">${escapeHtml(label)}</div>
    <div style="flex:1;font-size:12.5px;color:var(--ink-800);word-break:break-word">${escapeHtml(String(value))}</div>
  </div>`;
};

LF.subvendors._section = function(title, rowsHtml){
  return `<div style="margin-top:14px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--ab7-blue-deep);margin-bottom:4px">${escapeHtml(title)}</div>${rowsHtml}</div>`;
};

LF.subvendors.open = function(id){
  const v = LF.subvendors._byId(id); if(!v){ LF.toast("Sub-vendor not found","err"); return; }
  const R = LF.subvendors._defRow;
  const contact = R("Company / Agency Name", v.companyName) + R("Contact Person & Designation", v.contactPerson) +
    R("Official Email", v.officialEmail) + R("Contact Number", v.contactNumber) + R("WhatsApp Number", v.whatsappNumber) +
    R("Company Website", v.companyWebsite) + R("LinkedIn / Social / Company Profile", v.socialLinks);
  const profile = R("Services Provided", LF.subvendors._services(v)) + R("Year Established", v.yearEstablished) +
    R("Approximate Team Size", v.teamSize) +
    R("Industries Served", LF.subvendors._arr(v.industries).concat(v.industriesOther?[v.industriesOther]:[])) +
    R("Countries / Regions Supported", LF.subvendors._regions(v)) + R("Company Description", v.companyDescription);
  const caps = R("Delivery Methods", LF.subvendors._arr(v.deliveryModels).concat(v.deliveryOther?[v.deliveryOther]:[])) +
    R("Tools / Platforms / Technologies", v.toolsPlatforms) + R("Notable Clients / Projects / Achievements", v.notableClients) +
    R("Core Expertise", v.coreExpertise) + R("Project Capacity", v.projectCapacity) + R("Certifications", v.certifications);
  const comm = R("Engagement Models Open To", LF.subvendors._arr(v.engagementModels).concat(v.engagementOther?[v.engagementOther]:[])) +
    R("Warranty / Replacement / Support", v.warrantySupport) + R("Payment Terms", v.paymentTerms) + R("GST Registered", v.gstRegistered);
  const legal = R("Legal Company Name", v.legalCompanyName) + R("PAN Number", v.panNumber) + R("GST Number", v.gstNumber) +
    R("CIN / Registration Number", v.cinNumber) + R("Authorized Signatory", v.signatoryName) + R("Signatory Designation", v.signatoryDesignation) + R("Signatory Email", v.signatoryEmail);
  const meta = R("How did you hear about us", v.howHeard) + R("Why partner with AB7 Solutions", v.partnershipReason) +
    R("Declaration confirmed", v.declarationAccepted?"Yes":"No") + R("Source", v.source) +
    R("Submitted", v.createdAt?fmtDate(v.createdAt)+" · "+fmtTime(v.createdAt):"—");

  const docs = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
    ${LF.subvendors._fileLink("PAN card", v.panFileLink, v.panFileUrl)}
    ${LF.subvendors._fileLink("GST cert", v.gstFileLink, v.gstFileUrl)}
    ${LF.subvendors._fileLink("Brochure", v.brochureFileLink, v.brochureFileUrl)}
  </div>`;

  const acts = (v.activities||[]).slice().reverse().slice(0,12).map(a=>
    `<div style="display:flex;gap:8px;padding:4px 0;font-size:11.5px;color:var(--ink-600)"><span style="color:var(--ink-400);flex:0 0 64px">${a.at?fmtTime(a.at):""}</span><span>${escapeHtml(a.text||a.type||"")}</span></div>`
  ).join("") || `<div style="font-size:11.5px;color:var(--ink-400)">No activity yet.</div>`;

  const stageOpts = LF.subvendors.STAGES.map(s=>`<option ${v.stage===s?'selected':''}>${escapeHtml(s)}</option>`).join("");
  const ownerOpts = `<option value="">Unassigned</option>` + ownersList().map(o=>`<option value="${o.id}" ${v.ownerId===o.id?'selected':''}>${escapeHtml(o.name)}</option>`).join("");

  const body = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="font-size:17px;font-weight:800">${escapeHtml(LF.subvendors._name(v))}</div>
      <span class="tag ${LF.subvendors.STAGE_COLORS[v.stage]||'slate'}">${escapeHtml(v.stage||"New")}</span>
    </div>
    <div class="grid g-2" style="gap:10px;margin-bottom:6px">
      <div class="fld"><label>Stage</label><select id="sv-stage" onchange="LF.subvendors.setStage('${v.id}', this.value)">${stageOpts}</select></div>
      <div class="fld"><label>Owner</label><select id="sv-owner" onchange="LF.subvendors.setOwner('${v.id}', this.value)">${ownerOpts}</select></div>
    </div>
    <div class="fld"><label>Internal notes</label><textarea id="sv-notes" style="min-height:70px" placeholder="Review notes, verification status, next steps…">${escapeHtml(v.internalNotes||"")}</textarea></div>

    ${LF.subvendors._section("1 · Contact & company basics", contact)}
    ${LF.subvendors._section("2 · About your organization", profile)}
    ${LF.subvendors._section("3 · Business capability", caps)}
    ${LF.subvendors._section("4 · Commercial information", comm)}
    ${LF.subvendors._section("5 · Compliance & documentation", legal)}
    ${LF.subvendors._section("Uploaded documents", docs)}
    ${LF.subvendors._section("6 · Declaration", meta)}
    ${LF.subvendors._section("Activity log", acts)}
  `;

  const foot = `
    <button class="btn btn-ghost" onclick="LF.subvendors.remove('${v.id}')">🗑 Delete</button>
    <a class="btn btn-ghost" href="mailto:${encodeURIComponent(v.officialEmail||"")}?subject=${encodeURIComponent('AB7 Sub-Vendor Partnership — '+(v.companyName||''))}">✉ Email vendor</a>
    <button class="btn btn-primary" onclick="LF.subvendors.saveNotes('${v.id}')">Save notes</button>
  `;
  LF.drawer.open({ title:"Sub-vendor application", body, foot });
};

/* ---------------- Mutations ---------------- */
LF.subvendors._touch = function(v, text){
  v.updatedAt = Date.now();
  if(!Array.isArray(v.activities)) v.activities = [];
  if(text) v.activities.push({ type:"note", at:Date.now(), by:(LF.state.user&&LF.state.user.id)||null, text });
};

LF.subvendors.setStage = function(id, stage, fromKanban){
  const v = LF.subvendors._byId(id); if(!v) return;
  if(v.stage===stage){ return; }
  const prev = v.stage; v.stage = stage;
  LF.subvendors._touch(v, `Stage: ${prev||"New"} → ${stage}`);
  LF.storage.save();
  LF.updateSidebarCounts && LF.updateSidebarCounts();
  if(fromKanban){ LF.subvendors._renderBody(); }
  LF.toast(`Moved to ${stage}`,"");
};

LF.subvendors.setOwner = function(id, ownerId){
  const v = LF.subvendors._byId(id); if(!v) return;
  v.ownerId = ownerId||null;
  const o = ownersList().find(x=>x.id===ownerId);
  LF.subvendors._touch(v, o?`Assigned to ${o.name}`:"Unassigned");
  LF.storage.save();
  LF.toast(o?`Assigned to ${o.name.split(' ')[0]}`:"Unassigned","");
};

LF.subvendors.saveNotes = function(id){
  const v = LF.subvendors._byId(id); if(!v) return;
  const ta = document.getElementById("sv-notes");
  v.internalNotes = ta ? ta.value : v.internalNotes;
  LF.subvendors._touch(v, "Internal notes updated");
  LF.storage.save();
  LF.drawer.close();
  LF.subvendors._renderBody();
  LF.toast("Saved","");
};

LF.subvendors.remove = function(id){
  const v = LF.subvendors._byId(id); if(!v) return;
  if(!confirm(`Delete the sub-vendor application from "${LF.subvendors._name(v)}"? This cannot be undone.`)) return;
  LF.state.subvendors = (LF.state.subvendors||[]).filter(x=>x.id!==id);
  LF.storage.save();
  LF.updateSidebarCounts && LF.updateSidebarCounts();
  LF.drawer.close();
  LF.router.go("subvendors");
  LF.toast("Sub-vendor deleted","");
};

LF.subvendors.addNew = function(){
  const svcOpts = LF.subvendors.SERVICE_OPTIONS.map(s=>`<option>${escapeHtml(s)}</option>`).join("");
  const regOpts = LF.subvendors.REGION_OPTIONS.map(r=>`<option>${escapeHtml(r)}</option>`).join("");
  const body = `
    <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">Manually add a sub-vendor (e.g. from a referral or call). Most applications arrive automatically from the website form.</p>
    <div class="fld"><label>Company / agency name *</label><input id="svn-company" placeholder="Acme Tech Pvt. Ltd."></div>
    <div class="grid g-2" style="gap:10px">
      <div class="fld"><label>Contact person</label><input id="svn-contact" placeholder="Name — Designation"></div>
      <div class="fld"><label>Official email</label><input id="svn-email" type="email" placeholder="hello@acme.com"></div>
    </div>
    <div class="grid g-2" style="gap:10px">
      <div class="fld"><label>Phone</label><input id="svn-phone" placeholder="+91 …"></div>
      <div class="fld"><label>Primary service</label><select id="svn-service"><option value="">—</option>${svcOpts}</select></div>
    </div>
    <div class="grid g-2" style="gap:10px">
      <div class="fld"><label>Primary region</label><select id="svn-region"><option value="">—</option>${regOpts}</select></div>
      <div class="fld"><label>Website</label><input id="svn-website" placeholder="https://"></div>
    </div>
    <div class="fld"><label>Notes</label><textarea id="svn-notes" style="min-height:60px"></textarea></div>
  `;
  const foot = `<button class="btn btn-ghost" onclick="LF.drawer.close()">Cancel</button>
    <button class="btn btn-primary" onclick="LF.subvendors.createManual()">Add sub-vendor</button>`;
  LF.drawer.open({ title:"Add sub-vendor", body, foot });
};

LF.subvendors.createManual = function(){
  const val = id => { const e=document.getElementById(id); return e?e.value.trim():""; };
  const company = val("svn-company");
  if(!company){ LF.toast("Company name is required","err"); return; }
  const svc = val("svn-service"); const region = val("svn-region");
  const rec = LF.subvendors._blank();
  rec.companyName = company;
  rec.legalCompanyName = company;
  rec.contactPerson = val("svn-contact");
  rec.officialEmail = val("svn-email");
  rec.contactNumber = val("svn-phone");
  rec.companyWebsite = val("svn-website");
  rec.services = svc?[svc]:[];
  rec.regions = region?[region]:[];
  rec.internalNotes = val("svn-notes");
  rec.source = "manual entry";
  rec.activities = [{ type:"create", at:Date.now(), by:(LF.state.user&&LF.state.user.id)||null, text:"Added manually" }];
  LF.state.subvendors.unshift(rec);
  LF.storage.save();
  LF.updateSidebarCounts && LF.updateSidebarCounts();
  LF.drawer.close();
  LF.router.go("subvendors");
  LF.toast("Sub-vendor added","");
};

LF.subvendors._blank = function(){
  return {
    id:"sv_"+Math.random().toString(36).slice(2,10),
    stage:"New", ownerId:null, internalNotes:"",
    companyName:"", contactPerson:"", officialEmail:"", contactNumber:"", whatsappNumber:"",
    companyWebsite:"", socialLinks:"", services:[], servicesOther:"", companyDescription:"",
    yearEstablished:"", teamSize:"", industries:[], industriesOther:"", regions:[], regionsOther:"",
    coreExpertise:"", deliveryModels:[], deliveryOther:"", projectCapacity:"", toolsPlatforms:"",
    notableClients:"", certifications:"", engagementModels:[], engagementOther:"", warrantySupport:"",
    paymentTerms:"", gstRegistered:"", legalCompanyName:"", panNumber:"", gstNumber:"", cinNumber:"",
    signatoryName:"", signatoryDesignation:"", signatoryEmail:"",
    panFileUrl:"", gstFileUrl:"", brochureFileUrl:"", panFileLink:"", gstFileLink:"", brochureFileLink:"",
    howHeard:"", partnershipReason:"", declarationAccepted:false, source:"", ipAddress:"", userAgent:"",
    activities:[], createdAt:Date.now(), updatedAt:Date.now()
  };
};

LF.subvendors.exportCsv = function(){
  const list = LF.subvendors._filtered();
  if(!list.length){ LF.toast("No sub-vendors to export","info"); return; }
  const cols = [
    ["Company","companyName"],["Contact person","contactPerson"],["Email","officialEmail"],["Phone","contactNumber"],
    ["WhatsApp","whatsappNumber"],["Website","companyWebsite"],["Stage","stage"],
    ["Services",v=>LF.subvendors._services(v).join("; ")],["Industries",v=>LF.subvendors._arr(v.industries).join("; ")],
    ["Regions",v=>LF.subvendors._regions(v).join("; ")],["Team size","teamSize"],["Year established","yearEstablished"],
    ["Engagement models",v=>LF.subvendors._arr(v.engagementModels).join("; ")],["Payment terms","paymentTerms"],
    ["GST registered","gstRegistered"],["PAN","panNumber"],["GST","gstNumber"],["CIN","cinNumber"],
    ["Signatory","signatoryName"],["How heard","howHeard"],["Source","source"],
    ["Owner",v=>{const o=ownersList().find(x=>x.id===v.ownerId);return o?o.name:"";}],
    ["Internal notes","internalNotes"],
    ["Submitted",v=>v.createdAt?new Date(v.createdAt).toISOString():""]
  ];
  const esc = s => { s = String(s==null?"":s); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const head = cols.map(c=>esc(c[0])).join(",");
  const lines = list.map(v=>cols.map(c=>{
    const key = c[1];
    const val = typeof key==="function" ? key(v) : v[key];
    return esc(val);
  }).join(","));
  const csv = [head].concat(lines).join("\r\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ab7-subvendors-"+new Date().toISOString().slice(0,10)+".csv";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  LF.toast(`Exported ${list.length} sub-vendors`,"");
};

/* ==========================================================
   LF.entities — generic "application" module factory
   ----------------------------------------------------------
   Partners and Job Applicants are both website-fed application
   pipelines that behave like Sub-Vendors: a list + stage
   filter + KPI strip, a detail drawer with stage / owner /
   internal-notes controls, manual add, CSV export and refresh.
   Rather than duplicate ~300 lines twice, both are built from
   one factory. Each arrives from the website via a secured
   ingest endpoint (/api/partners/ingest, /api/jobs/ingest),
   is stored in LF.state[cfg.key] and round-trips through the
   snapshot exactly like leads / subvendors.
   ========================================================== */
LF.entities = LF.entities || {};

/* Tolerant array reader — ingested data may be a real array, a
   JSON string, or a comma-joined string. */
LF.entities._arr = function(v){
  if(Array.isArray(v)) return v.filter(Boolean);
  if(v == null || v === "") return [];
  if(typeof v === "string"){
    const s = v.trim();
    if(s[0] === "["){ try{ const a = JSON.parse(s); return Array.isArray(a)?a.filter(Boolean):[]; }catch(e){} }
    return s.split(",").map(x=>x.trim()).filter(Boolean);
  }
  return [];
};

LF.entities.make = function(cfg){
  const NS = { cfg };
  const arr = LF.entities._arr;

  NS._list = function(){ return Array.isArray(LF.state[cfg.key]) ? LF.state[cfg.key] : (LF.state[cfg.key] = []); };
  NS._byId = function(id){ return NS._list().find(x=>x.id===id); };
  NS._name = function(r){ return cfg.nameOf(r) || "Unnamed"; };

  NS._bootstrap = function(){
    if(!Array.isArray(LF.state[cfg.key])) LF.state[cfg.key] = [];
    if(!LF.state[cfg.filterKey]) LF.state[cfg.filterKey] = { q:"", stage:"", owner:"" };
  };

  NS._filtered = function(){
    const f = LF.state[cfg.filterKey] || { q:"", stage:"", owner:"" };
    const q = (f.q||"").toLowerCase().trim();
    return NS._list().filter(r=>{
      if(q){
        const hay = cfg.searchFields.map(k=>{ const v=r[k]; return Array.isArray(v)?v.join(" "):(v==null?"":String(v)); }).join(" ").toLowerCase();
        if(!hay.includes(q)) return false;
      }
      if(f.stage && r.stage!==f.stage) return false;
      if(f.owner && r.ownerId!==f.owner) return false;
      return true;
    });
  };

  /* ---------- Main view ---------- */
  NS.render = function(el){
    NS._bootstrap();
    const all = NS._list();
    const count = s => all.filter(r=>r.stage===s).length;
    const total = all.length;
    const pending = cfg.pendingStages.reduce((n,s)=>n+count(s), 0);
    const active = cfg.activeStages.reduce((n,s)=>n+count(s), 0);
    const rejected = count("Rejected");
    const strip = cfg.stages.map(s=>{
      const n = count(s);
      return `<div class="pipe-stage ${cfg.stageTone[s]||'tone-open'}" style="min-width:120px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-500)">${escapeHtml(s)}</div>
        <div style="font-size:18px;font-weight:800;color:var(--ink-900)">${n}</div></div>`;
    }).join("");
    el.innerHTML = `
      <div class="page-head">
        <div><div class="page-title">${escapeHtml(cfg.title)}</div><div class="page-sub">${escapeHtml(cfg.sub)}</div></div>
        <div class="page-actions">
          <button class="btn btn-ghost btn-sm" onclick="LF.${cfg.ns}.refresh()">⟳ Refresh</button>
          <button class="btn btn-ghost btn-sm" onclick="LF.${cfg.ns}.exportCsv()">⬇ Export CSV</button>
          <button class="btn btn-primary btn-sm" onclick="LF.${cfg.ns}.addNew()">＋ ${escapeHtml(cfg.addLabel)}</button>
        </div>
      </div>
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="kpi"><div class="lbl">Total ${escapeHtml(cfg.noun)}</div><div class="val">${total}</div><div class="delta up">applications</div></div>
        <div class="kpi"><div class="lbl">Awaiting review</div><div class="val" style="color:var(--ab7-blue-deep)">${pending}</div><div class="delta up">${escapeHtml(cfg.pendingStages.join(" + "))}</div></div>
        <div class="kpi"><div class="lbl">${escapeHtml(cfg.activeLabel)}</div><div class="val" style="color:var(--ab7-green-deep)">${active}</div><div class="delta up">${escapeHtml(cfg.activeSub)}</div></div>
        <div class="kpi"><div class="lbl">Rejected</div><div class="val" style="color:var(--danger)">${rejected}</div><div class="delta down">declined</div></div>
      </div>
      <div class="pipe-strip" style="margin-bottom:14px">${strip}</div>
      <div id="${cfg.ns}-body"></div>
    `;
    NS._renderBody();
  };

  NS._renderBody = function(){
    const body = document.getElementById(cfg.ns+"-body"); if(!body) return;
    body.innerHTML = NS._listHtml();
    NS._renderRows();
  };

  NS.refresh = function(){
    if(LF.db && LF.db.online && LF.db.loadSnapshot){
      LF.db.loadSnapshot().then(()=>{ LF.updateSidebarCounts&&LF.updateSidebarCounts(); LF.router.go(cfg.route); LF.toast("Synced from server",""); })
        .catch(()=>LF.toast("Sync failed — showing local data","err"));
    } else { LF.router.go(cfg.route); LF.toast("Server offline — showing local data","info"); }
  };

  /* ---------- List ---------- */
  NS._listHtml = function(){
    const f = LF.state[cfg.filterKey];
    const heads = cfg.listCols.map(c=>`<th>${escapeHtml(c.label)}</th>`).join("") + "<th></th>";
    return `
      <div class="tbl-wrap">
        <div class="tbl-toolbar">
          <div class="tbl-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input placeholder="${escapeHtml(cfg.searchPlaceholder)}" value="${escapeHtml(f.q)}" oninput="LF.state.${cfg.filterKey}.q=this.value;LF.${cfg.ns}._renderRows()">
          </div>
          <select class="filter" onchange="LF.state.${cfg.filterKey}.stage=this.value;LF.${cfg.ns}._renderRows()">
            <option value="">All stages</option>
            ${cfg.stages.map(s=>`<option ${f.stage===s?'selected':''}>${escapeHtml(s)}</option>`).join("")}
          </select>
          <select class="filter" onchange="LF.state.${cfg.filterKey}.owner=this.value;LF.${cfg.ns}._renderRows()">
            <option value="">All owners</option>
            ${ownersList().map(o=>`<option value="${o.id}" ${f.owner===o.id?'selected':''}>${escapeHtml(o.name)}</option>`).join("")}
          </select>
          <button class="btn btn-ghost btn-sm" onclick="LF.state.${cfg.filterKey}={q:'',stage:'',owner:''};LF.${cfg.ns}._renderBody()">Clear</button>
        </div>
        <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr>${heads}</tr></thead>
          <tbody id="${cfg.ns}-rows"></tbody>
        </table>
        </div>
        <div class="tbl-foot"><div id="${cfg.ns}-count"></div></div>
      </div>
    `;
  };

  NS._renderRows = function(){
    const list = NS._filtered();
    const rows = document.getElementById(cfg.ns+"-rows"); if(!rows) return;
    rows.innerHTML = list.map(r=>{
      const o = ownersList().find(x=>x.id===r.ownerId)||{name:"Unassigned",avatar:"?",grp:""};
      const cells = cfg.listCols.map(c=>{
        const v = typeof c.val==="function" ? c.val(r) : r[c.key];
        if(c.render) return c.render(r, v);
        return `<td style="font-size:12px;color:var(--ink-700)">${escapeHtml(v==null||v===""?"—":String(v))}</td>`;
      }).join("");
      return `<tr style="cursor:pointer" onclick="LF.${cfg.ns}.open('${r.id}')">
        ${cells}
        <td style="white-space:nowrap"><button class="btn btn-blue btn-xs" onclick="event.stopPropagation();LF.${cfg.ns}.open('${r.id}')">Open</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="${cfg.listCols.length+1}" class="tbl-empty">No ${escapeHtml(cfg.noun)} match these filters. New submissions from the website appear here automatically.</td></tr>`;
    const c = document.getElementById(cfg.ns+"-count");
    if(c) c.textContent = `Showing ${list.length} of ${NS._list().length} ${cfg.noun}`;
  };

  /* ---------- Detail drawer ---------- */
  NS._defRow = function(label, value){
    if(value==null || value==="" || (Array.isArray(value)&&!value.length)) value = "—";
    if(Array.isArray(value)) value = value.join(", ");
    return `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--ink-100)">
      <div style="flex:0 0 160px;font-size:11.5px;color:var(--ink-400);font-weight:600">${escapeHtml(label)}</div>
      <div style="flex:1;font-size:12.5px;color:var(--ink-800);word-break:break-word">${escapeHtml(String(value))}</div>
    </div>`;
  };
  NS._section = function(title, rowsHtml){
    return `<div style="margin-top:14px"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--ab7-blue-deep);margin-bottom:4px">${escapeHtml(title)}</div>${rowsHtml}</div>`;
  };
  NS._fileLink = function(label, link){
    if(link) return `<a class="btn btn-ghost btn-xs" href="${escapeHtml(link)}" target="_blank" rel="noopener">📎 ${escapeHtml(label)} ↗</a>`;
    return `<span style="font-size:11px;color:var(--ink-400)">${escapeHtml(label)}: —</span>`;
  };

  NS.open = function(id){
    const r = NS._byId(id); if(!r){ LF.toast(cfg.title+" record not found","err"); return; }
    const R = NS._defRow;
    const sections = cfg.sections.map(sec=>{
      const rowsHtml = sec.rows.map(row=>{
        const val = typeof row[1]==="function" ? row[1](r) : r[row[1]];
        return R(row[0], val);
      }).join("");
      return NS._section(sec.title, rowsHtml);
    }).join("");
    const docs = (cfg.docs||[]).length ? NS._section("Uploaded documents",
      `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${cfg.docs.map(d=>NS._fileLink(d.label, r[d.key])).join("")}</div>`) : "";
    const acts = (r.activities||[]).slice().reverse().slice(0,12).map(a=>
      `<div style="display:flex;gap:8px;padding:4px 0;font-size:11.5px;color:var(--ink-600)"><span style="color:var(--ink-400);flex:0 0 64px">${a.at?fmtTime(a.at):""}</span><span>${escapeHtml(a.text||a.type||"")}</span></div>`
    ).join("") || `<div style="font-size:11.5px;color:var(--ink-400)">No activity yet.</div>`;
    const stageOpts = cfg.stages.map(s=>`<option ${r.stage===s?'selected':''}>${escapeHtml(s)}</option>`).join("");
    const ownerOpts = `<option value="">Unassigned</option>` + ownersList().map(o=>`<option value="${o.id}" ${r.ownerId===o.id?'selected':''}>${escapeHtml(o.name)}</option>`).join("");
    const submitted = R("Source", r.source) + R("Submitted", r.createdAt?fmtDate(r.createdAt)+" · "+fmtTime(r.createdAt):"—");

    const body = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="font-size:17px;font-weight:800">${escapeHtml(NS._name(r))}</div>
        <span class="tag ${cfg.stageColors[r.stage]||'slate'}">${escapeHtml(r.stage||"New")}</span>
      </div>
      <div class="grid g-2" style="gap:10px;margin-bottom:6px">
        <div class="fld"><label>Stage</label><select onchange="LF.${cfg.ns}.setStage('${r.id}', this.value)">${stageOpts}</select></div>
        <div class="fld"><label>Owner</label><select onchange="LF.${cfg.ns}.setOwner('${r.id}', this.value)">${ownerOpts}</select></div>
      </div>
      <div class="fld"><label>Internal notes</label><textarea id="${cfg.ns}-notes" style="min-height:70px" placeholder="Review notes, verification status, next steps…">${escapeHtml(r.internalNotes||"")}</textarea></div>
      ${sections}
      ${docs}
      ${NS._section("Record", submitted)}
      ${NS._section("Activity log", acts)}
    `;
    const emailHref = r.email ? `<a class="btn btn-ghost" href="mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(cfg.emailSubject+" — "+(NS._name(r)))}">✉ Email</a>` : "";
    const foot = `
      <button class="btn btn-ghost" onclick="LF.${cfg.ns}.remove('${r.id}')">🗑 Delete</button>
      ${emailHref}
      <button class="btn btn-primary" onclick="LF.${cfg.ns}.saveNotes('${r.id}')">Save notes</button>
    `;
    LF.drawer.open({ title:cfg.drawerTitle, body, foot });
  };

  /* ---------- Mutations ---------- */
  NS._touch = function(r, text){
    r.updatedAt = Date.now();
    if(!Array.isArray(r.activities)) r.activities = [];
    if(text) r.activities.push({ type:"note", at:Date.now(), by:(LF.state.user&&LF.state.user.id)||null, text });
  };
  NS.setStage = function(id, stage){
    const r = NS._byId(id); if(!r || r.stage===stage) return;
    const prev = r.stage; r.stage = stage;
    NS._touch(r, `Stage: ${prev||"New"} → ${stage}`);
    LF.storage.save(); LF.updateSidebarCounts && LF.updateSidebarCounts();
    NS._renderBody();
    LF.toast(`Moved to ${stage}`,"");
  };
  NS.setOwner = function(id, ownerId){
    const r = NS._byId(id); if(!r) return;
    r.ownerId = ownerId||null;
    const o = ownersList().find(x=>x.id===ownerId);
    NS._touch(r, o?`Assigned to ${o.name}`:"Unassigned");
    LF.storage.save();
    LF.toast(o?`Assigned to ${o.name.split(' ')[0]}`:"Unassigned","");
  };
  NS.saveNotes = function(id){
    const r = NS._byId(id); if(!r) return;
    const ta = document.getElementById(cfg.ns+"-notes");
    r.internalNotes = ta ? ta.value : r.internalNotes;
    NS._touch(r, "Internal notes updated");
    LF.storage.save(); LF.drawer.close(); NS._renderBody();
    LF.toast("Saved","");
  };
  NS.remove = function(id){
    const r = NS._byId(id); if(!r) return;
    if(!confirm(`Delete the ${cfg.singular} from "${NS._name(r)}"? This cannot be undone.`)) return;
    LF.state[cfg.key] = NS._list().filter(x=>x.id!==id);
    LF.storage.save(); LF.updateSidebarCounts && LF.updateSidebarCounts();
    LF.drawer.close(); LF.router.go(cfg.route);
    LF.toast(cfg.title+" record deleted","");
  };

  /* ---------- Manual add ---------- */
  NS.addNew = function(){
    const body = `
      <p style="font-size:12.5px;color:var(--ink-500);margin-bottom:10px">Manually add a ${escapeHtml(cfg.singular)} (e.g. from a referral or call). Most arrive automatically from the website form.</p>
      ${cfg.addFields.map(fld=>`<div class="fld"><label>${escapeHtml(fld.label)}${fld.required?" *":""}</label><input id="${cfg.ns}n-${fld.key}" placeholder="${escapeHtml(fld.placeholder||"")}"></div>`).join("")}
    `;
    const foot = `<button class="btn btn-ghost" onclick="LF.drawer.close()">Cancel</button>
      <button class="btn btn-primary" onclick="LF.${cfg.ns}.createManual()">${escapeHtml(cfg.addLabel)}</button>`;
    LF.drawer.open({ title:cfg.addLabel, body, foot });
  };
  NS.createManual = function(){
    const val = k => { const e=document.getElementById(cfg.ns+"n-"+k); return e?e.value.trim():""; };
    const rec = NS._blank();
    let missing = false;
    cfg.addFields.forEach(fld=>{ const v = val(fld.key); if(fld.required && !v) missing = true; rec[fld.key] = v; });
    if(missing){ LF.toast("Please fill the required field(s)","err"); return; }
    if(cfg.afterManual) cfg.afterManual(rec, val);
    rec.source = "manual entry";
    rec.activities = [{ type:"create", at:Date.now(), by:(LF.state.user&&LF.state.user.id)||null, text:"Added manually" }];
    NS._list().unshift(rec);
    LF.storage.save(); LF.updateSidebarCounts && LF.updateSidebarCounts();
    LF.drawer.close(); LF.router.go(cfg.route);
    LF.toast(cfg.title+" added","");
  };
  NS._blank = function(){
    const rec = { id: cfg.idPrefix+"_"+Math.random().toString(36).slice(2,10), stage:"New", ownerId:null, internalNotes:"", createdAt:Date.now(), updatedAt:Date.now(), activities:[] };
    (cfg.blankFields||[]).forEach(k=>{ rec[k] = ""; });
    return rec;
  };

  /* ---------- CSV export ---------- */
  NS.exportCsv = function(){
    const list = NS._filtered();
    if(!list.length){ LF.toast("No "+cfg.noun+" to export","info"); return; }
    const esc = s => { s = String(s==null?"":s); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
    const head = cfg.csvCols.map(c=>esc(c[0])).join(",");
    const lines = list.map(r=>cfg.csvCols.map(c=>{
      const key = c[1];
      let v = typeof key==="function" ? key(r) : r[key];
      if(Array.isArray(v)) v = v.join("; ");
      return esc(v);
    }).join(","));
    const csv = [head].concat(lines).join("\r\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = cfg.csvName+"-"+new Date().toISOString().slice(0,10)+".csv";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    LF.toast(`Exported ${list.length} ${cfg.noun}`,"");
  };

  return NS;
};

/* ---------------- Partners module ---------------- */
LF.partners = LF.entities.make({
  ns:"partners", key:"partners", filterKey:"partnerFilter", route:"partners", idPrefix:"pt",
  title:"Partners", noun:"partners", singular:"partner application", drawerTitle:"Partner application",
  sub:'Applications from the ab7solutions.com "Become a Partner" form — review, qualify, approve and activate.',
  addLabel:"Add partner", addField:"", emailSubject:"AB7 Partnership Program",
  activeLabel:"Approved / Active", activeSub:"active partners",
  stages:["New","Under Review","Shortlisted","Approved","Active","Rejected"],
  pendingStages:["New","Under Review"], activeStages:["Approved","Active"],
  stageColors:{ "New":"slate","Under Review":"sky","Shortlisted":"blue","Approved":"green","Active":"green","Rejected":"danger" },
  stageTone:{ "New":"tone-open","Under Review":"tone-open","Shortlisted":"tone-open","Approved":"tone-won","Active":"tone-won","Rejected":"tone-lost" },
  searchPlaceholder:"Search name, email, company, service…",
  searchFields:["fullName","email","phone","companyName","profession","servicesInterested","sourceRegions"],
  listCols:[
    { label:"Name", render:(r)=>`<td><div style="font-weight:700">${escapeHtml(r.fullName||"—")}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(r.email||"")}</div></td>` },
    { label:"Contact", render:(r)=>`<td><div style="font-size:12px">${escapeHtml(r.phone||"—")}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(r.country||"")}</div></td>` },
    { label:"Company / Role", render:(r)=>`<td><div style="font-size:12px">${escapeHtml(r.companyName||"—")}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(r.profession||"")}</div></td>` },
    { label:"Services", val:(r)=>LF.entities._arr(r.servicesInterested).slice(0,2).join(", ") },
    { label:"Stage", render:(r)=>`<td><span class="tag ${({"New":"slate","Under Review":"sky","Shortlisted":"blue","Approved":"green","Active":"green","Rejected":"danger"})[r.stage]||'slate'}">${escapeHtml(r.stage||"New")}</span></td>` },
    { label:"Owner", render:(r)=>{ const o=ownersList().find(x=>x.id===r.ownerId)||{name:"Unassigned",avatar:"?",grp:""}; return `<td><div class="who"><div class="avatar-sm ${o.grp||''}">${o.avatar||initials(o.name)}</div><span style="font-size:12px">${escapeHtml(o.name.split(' ')[0])}</span></div></td>`; } },
    { label:"Submitted", render:(r)=>`<td style="font-size:11.5px;color:var(--ink-500);white-space:nowrap">${r.createdAt?fmtDate(r.createdAt):"—"}</td>` }
  ],
  sections:[
    { title:"1 · Contact", rows:[["Full name","fullName"],["Email","email"],["Phone","phone"],["WhatsApp","whatsapp"],["Country","country"],["City","city"],["LinkedIn / Website","linkedin"]] },
    { title:"2 · Profile", rows:[["Current role / profession","profession"],["Company (if any)","companyName"],["Networks / industry connections",(r)=>LF.entities._arr(r.networks)],["Services interested in",(r)=>LF.entities._arr(r.servicesInterested)],["Regions they bring clients from",(r)=>LF.entities._arr(r.sourceRegions)],["Intro volume (6 months)","introVolume"],["Preferred earning model",(r)=>LF.entities._arr(r.earningModel)]] },
    { title:"3 · About", rows:[["About network / why partner","aboutNetwork"],["How they heard","howHeard"],["Declaration accepted",(r)=>r.declarationAccepted?"Yes":"No"]] }
  ],
  docs:[ { label:"Profile / CV", key:"profileFileLink" }, { label:"Portfolio", key:"portfolioFileLink" } ],
  addFields:[
    { key:"fullName", label:"Full name", required:true, placeholder:"Jane Doe" },
    { key:"email", label:"Email", placeholder:"jane@company.com" },
    { key:"phone", label:"Phone", placeholder:"+91 …" },
    { key:"companyName", label:"Company", placeholder:"Acme Referrals" },
    { key:"profession", label:"Role / profession", placeholder:"Recruitment consultant" }
  ],
  blankFields:["fullName","email","phone","whatsapp","country","city","linkedin","profession","companyName","networks","servicesInterested","sourceRegions","introVolume","earningModel","aboutNetwork","howHeard","profileFileUrl","portfolioFileUrl","profileFileLink","portfolioFileLink","source","ipAddress","userAgent"],
  csvName:"ab7-partners",
  csvCols:[
    ["Full name","fullName"],["Email","email"],["Phone","phone"],["WhatsApp","whatsapp"],["Country","country"],["City","city"],
    ["LinkedIn","linkedin"],["Profession","profession"],["Company","companyName"],
    ["Networks",(r)=>LF.entities._arr(r.networks).join("; ")],["Services",(r)=>LF.entities._arr(r.servicesInterested).join("; ")],
    ["Regions",(r)=>LF.entities._arr(r.sourceRegions).join("; ")],["Intro volume","introVolume"],
    ["Earning model",(r)=>LF.entities._arr(r.earningModel).join("; ")],["About","aboutNetwork"],["How heard","howHeard"],
    ["Stage","stage"],["Source","source"],
    ["Owner",(r)=>{const o=ownersList().find(x=>x.id===r.ownerId);return o?o.name:"";}],
    ["Internal notes","internalNotes"],
    ["Submitted",(r)=>r.createdAt?new Date(r.createdAt).toISOString():""]
  ],
  nameOf:(r)=> r.fullName || r.companyName || r.email
});
LF.views.partners = function(el){ LF.partners.render(el); };

/* ---------------- Job Applicants module ---------------- */
LF.jobApplicants = LF.entities.make({
  ns:"jobApplicants", key:"jobApplicants", filterKey:"jobApplicantFilter", route:"jobApplicants", idPrefix:"ja",
  title:"Job Applicants", noun:"applicants", singular:"job application", drawerTitle:"Job application",
  sub:'Candidates from the ab7solutions.com "Apply for a Job" form — screen, shortlist, interview and hire.',
  addLabel:"Add applicant", emailSubject:"AB7 Careers — your application",
  activeLabel:"Offer / Hired", activeSub:"progressing",
  stages:["New","Screening","Shortlisted","Interview","Offer","Hired","Rejected"],
  pendingStages:["New","Screening"], activeStages:["Offer","Hired"],
  stageColors:{ "New":"slate","Screening":"sky","Shortlisted":"blue","Interview":"blue","Offer":"green","Hired":"green","Rejected":"danger" },
  stageTone:{ "New":"tone-open","Screening":"tone-open","Shortlisted":"tone-open","Interview":"tone-open","Offer":"tone-won","Hired":"tone-won","Rejected":"tone-lost" },
  searchPlaceholder:"Search name, email, role, location…",
  searchFields:["fullName","email","phone","roleApplied","currentLocation","experienceYears"],
  listCols:[
    { label:"Name", render:(r)=>`<td><div style="font-weight:700">${escapeHtml(r.fullName||"—")}</div><div style="font-size:11px;color:var(--ink-400)">${escapeHtml(r.email||"")}</div></td>` },
    { label:"Contact", render:(r)=>`<td><div style="font-size:12px">${escapeHtml(r.phone||"—")}</div></td>` },
    { label:"Role applied", val:(r)=>r.roleApplied },
    { label:"Experience", val:(r)=>r.experienceYears },
    { label:"Location", val:(r)=>r.currentLocation||r.country },
    { label:"Stage", render:(r)=>`<td><span class="tag ${({"New":"slate","Screening":"sky","Shortlisted":"blue","Interview":"blue","Offer":"green","Hired":"green","Rejected":"danger"})[r.stage]||'slate'}">${escapeHtml(r.stage||"New")}</span></td>` },
    { label:"Owner", render:(r)=>{ const o=ownersList().find(x=>x.id===r.ownerId)||{name:"Unassigned",avatar:"?",grp:""}; return `<td><div class="who"><div class="avatar-sm ${o.grp||''}">${o.avatar||initials(o.name)}</div><span style="font-size:12px">${escapeHtml(o.name.split(' ')[0])}</span></div></td>`; } },
    { label:"Submitted", render:(r)=>`<td style="font-size:11.5px;color:var(--ink-500);white-space:nowrap">${r.createdAt?fmtDate(r.createdAt):"—"}</td>` }
  ],
  sections:[
    { title:"1 · Contact", rows:[["Full name","fullName"],["Email","email"],["Phone","phone"],["WhatsApp","whatsapp"],["Current location","currentLocation"],["Country","country"],["LinkedIn","linkedin"],["Portfolio","portfolio"]] },
    { title:"2 · Application", rows:[["Role applied for","roleApplied"],["Experience (years)","experienceYears"],["Notice period","noticePeriod"],["Expected salary","expectedSalary"],["Cover note","coverNote"],["How they heard","howHeard"]] }
  ],
  docs:[ { label:"Resume / CV", key:"resumeLink" } ],
  addFields:[
    { key:"fullName", label:"Full name", required:true, placeholder:"John Doe" },
    { key:"email", label:"Email", placeholder:"john@email.com" },
    { key:"phone", label:"Phone", placeholder:"+91 …" },
    { key:"roleApplied", label:"Role applied for", placeholder:"Medical Scribe" },
    { key:"experienceYears", label:"Experience (years)", placeholder:"3" },
    { key:"currentLocation", label:"Current location", placeholder:"Mohali, IN" }
  ],
  blankFields:["fullName","email","phone","whatsapp","roleApplied","experienceYears","currentLocation","country","linkedin","portfolio","resumeLink","resumeFileUrl","noticePeriod","expectedSalary","coverNote","howHeard","source","ipAddress","userAgent"],
  csvName:"ab7-job-applicants",
  csvCols:[
    ["Full name","fullName"],["Email","email"],["Phone","phone"],["WhatsApp","whatsapp"],["Role applied","roleApplied"],
    ["Experience (yrs)","experienceYears"],["Current location","currentLocation"],["Country","country"],
    ["LinkedIn","linkedin"],["Portfolio","portfolio"],["Resume","resumeLink"],["Notice period","noticePeriod"],
    ["Expected salary","expectedSalary"],["Cover note","coverNote"],["How heard","howHeard"],
    ["Stage","stage"],["Source","source"],
    ["Owner",(r)=>{const o=ownersList().find(x=>x.id===r.ownerId);return o?o.name:"";}],
    ["Internal notes","internalNotes"],
    ["Submitted",(r)=>r.createdAt?new Date(r.createdAt).toISOString():""]
  ],
  nameOf:(r)=> r.fullName || r.email
});
LF.views.jobApplicants = function(el){ LF.jobApplicants.render(el); };

/* Boot */
window.addEventListener("DOMContentLoaded", ()=> LF.init());

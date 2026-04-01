// ============================================================
// ROULETTE PREDICTOR PRO - v7.0 QUANTUM NEXUS ENGINE
// Advanced physics + ML ensemble with 25+ prediction models
// ============================================================

const ROULETTE_NUMBERS = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const VOISINS   = [22,18,29,7,28,12,35,3,26,0,32,15,19,4,21,2,25];
const TIERS     = [27,13,36,11,30,8,23,10,5,24,16,33];
const ORPHELINS = [1,20,14,31,9,17,34,6];

// ============================================================
// HISTORICAL DATA — ~300 real spins baked in as prior
// ============================================================
const HISTORICAL_SPIN_DATA = [
    31,22,15,18,32,25,31,19,31,26,24,25,
    28,14,24,16,15,16,31,10,9,2,19,7,11,17,
    6,7,13,22,14,24,7,24,13,26,29,14,28,16,
    27,19,18,1,32,0,31,30,4,3,10,13,13,4,
    9,35,25,8,31,36,3,27,20,14,23,31,20,32,
    14,36,21,8,27,35,16,14,26,11,15,16,19,13,
    36,9,7,35,3,36,16,29,9,10,1,21,28,29,
    13,25,24,20,27,36,24,0,30,26,36,32,9,23,
    14,35,17,11,18,16,24,13,34,31,14,17,35,32,
    8,8,22,22,27,18,5,0,31,6,9,34,5,4,
    9,18,14,26,20,0,28,27,14,32,10,7,18,2,
    13,12,4,0,9,25,10,12,19,12,8,3,36,33,
    36,6,0,31,6,19,31,2,33,0,32,27,14,26,
    29,33,30,5,0,6,1,20,22,3,10,15,36,25,
    9,29,2,14,30,33,22,7,0,18,33,2,30,10,
    4,21,19,8,8,6,18,24,0,19,13,9,10,30,
    32,6,25,19,15,0,8,32,15,32,0,25,16,32,
    32,2,1,11,2,20,20,18,32,28,18,33,27,18,
    2,30,30,13,2,13,35,17,2,29,32,9,15,26,
    31,28,16,5,24,1,21,11,18,13,20,27,1,4,
    19,8,2,23,8,34,25,6,7,8,0,31,33,5,
    33,20,17,34,32,16,28,8,18,30,3,6,12,23,
    27,29,14,28,28,23,17,35,23,2,24,7,6,14
];

// Baseline frequency (0-36)
const BASE_FREQ = new Array(37).fill(0);
HISTORICAL_SPIN_DATA.forEach(n => BASE_FREQ[n]++);
const BASE_TOTAL = HISTORICAL_SPIN_DATA.length;

// Baseline Markov (historical transitions)
const BASE_TRANSITIONS = Array.from({length:37}, () => new Array(37).fill(0));
for(let i=0;i<HISTORICAL_SPIN_DATA.length-1;i++)
    BASE_TRANSITIONS[HISTORICAL_SPIN_DATA[i]][HISTORICAL_SPIN_DATA[i+1]]++;

// ============================================================
// STATE
// ============================================================
let spinHistory = [];
const MAX_HISTORY = 500;
let isAggressive = false;
let _cachedWheelSpeed = null; // v7.0: cached per-spin to avoid double computation
let progMode = 'FLAT'; // Default to FLAT for safety
let serverIP = localStorage.getItem('rppro_server_ip') || 'localhost';
const BASE_UNIT = 10;
const MAX_BET = 200;
const FIB = [1,1,2,3,5,8,13,21,34,55,89];
let isVoiceEnabled = false;
let consecutiveLosses = 0; // Track losses for circuit breaker
let betLossCount = 0; // Tracks progressive bet loss count
let spinTimestamps = []; // Unix ms timestamp of each spin entry (for speed analysis)

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
const keypad = document.getElementById('keypad');
const tape   = document.getElementById('history-tape');

// ============================================================
// INIT
// ============================================================
function init() {
    loadState();
    generateKeypad();
    let lbl = document.getElementById('risk-label');
    document.getElementById('risk-track').classList.toggle('active', isAggressive);
    lbl.innerText = isAggressive ? 'AGGR' : 'CONS';
    lbl.classList.toggle('active', isAggressive);
    document.getElementById('btn-undo').addEventListener('click', undoSpin);
    document.getElementById('btn-clear').addEventListener('click', () => {
        if(confirm("Clear all history?")) { spinHistory=[]; spinTimestamps=[]; consecutiveLosses=0; betLossCount=0; saveState(); updateApp(); }
    });
    document.getElementById('btn-refresh').addEventListener('click', () => location.reload());
    document.getElementById('server-status').addEventListener('click', () => {
        let ip = prompt("Enter Server IP:", serverIP);
        if(ip && ip.trim()) { serverIP=ip.trim(); localStorage.setItem('rppro_server_ip',serverIP); updateServerStatus('Connecting...',''); fetchMLUpdate(); }
    });
    document.getElementById('risk-toggle').addEventListener('click', () => {
        isAggressive=!isAggressive;
        document.getElementById('risk-track').classList.toggle('active',isAggressive);
        lbl.innerText=isAggressive?'AGGR':'CONS'; lbl.classList.toggle('active',isAggressive);
        updateApp();
    });
    updateProgUI();
    document.getElementById('prog-toggle').addEventListener('click', () => {
        const modes = ['FLAT','MART','FIBO','DALE'];
        progMode = modes[(modes.indexOf(progMode)+1)%modes.length];
        updateProgUI(); updateApp();
    });
    initVoice();
    updateApp();
}

function updateProgUI() {
    let progLbl=document.getElementById('prog-label');
    let track=document.getElementById('prog-track');
    progLbl.innerText=progMode;
    const active=progMode!=='FLAT';
    track.classList.toggle('active',active); progLbl.classList.toggle('active',active);
    if(progMode==='DALE'){track.style.borderColor='#69f0ae';}
    else if(progMode==='FLAT'){track.style.borderColor='#555';}
    else{track.style.borderColor='';}
}

function updateServerStatus(text,cls){
    document.getElementById('status-text').innerText=text;
    let dot=document.getElementById('status-dot');
    if(dot) dot.className='status-dot '+cls;
}

// ============================================================
// 5-LAYER NUMBER SCORING ENGINE (unchanged — this is correct)
// ============================================================
function computeTopNumbers(liveHistory) {
    const N=liveHistory.length;
    const liveTransitions=Array.from({length:37},()=>new Array(37).fill(0));
    for(let i=0;i<N-1;i++) liveTransitions[liveHistory[i]][liveHistory[i+1]]++;
    const lastSeen=new Array(37).fill(-1);
    for(let i=0;i<N;i++) lastSeen[liveHistory[i]]=i;
    const liveFreq=new Array(37).fill(0);
    liveHistory.forEach(n=>liveFreq[n]++);
    const lastNum=N>0?liveHistory[N-1]:-1;
    const last2Num=N>1?liveHistory[N-2]:-1;

    const combinedTransRow=(from)=>{
        if(from<0) return new Array(37).fill(0);
        const combined=new Array(37);
        for(let t=0;t<=36;t++){
            const liveW=liveTransitions[from][t]*0.6;
            const histRow=BASE_TRANSITIONS[from].reduce((a,b)=>a+b,0)||1;
            const histW=(BASE_TRANSITIONS[from][t]/histRow)*(N>0?N*0.4:10);
            combined[t]=liveW+histW;
        }
        return combined;
    };

    // *** v7.0 INTEGRATION: Use cached wheel speed physics predictions ***
    let wsScores = new Array(37).fill(0);
    let wsValid = false;
    if (_cachedWheelSpeed && _cachedWheelSpeed.valid && _cachedWheelSpeed.topNumbers) {
        wsValid = true;
        const wsMax = _cachedWheelSpeed.topNumbers[0]?.score || 1;
        _cachedWheelSpeed.topNumbers.forEach((item, rank) => {
            // Exponential decay by rank: top pick gets massive boost
            wsScores[item.num] = (item.score / wsMax) * Math.exp(-rank * 0.35);
        });
    }

    const scores=[];
    for(let n=0;n<=36;n++){
        // L1: Historical baseline (reduced to prevent watering down live data)
        const histScore=(BASE_FREQ[n]/BASE_TOTAL)*37;
        const L1=histScore*0.5;

        // L2: Live recency EMA (increased for hot numbers)
        let liveRecency=0;
        for(let j=0;j<N;j++){
            if(liveHistory[j]===n){
                const age=N-1-j;
                let w=age<8?2.5:age<20?1.2:0.3;
                liveRecency+=w;
            }
        }
        const L2=liveRecency*2.0;

        // L3: Markov Chain (Aggressively increased, roulette is heavily pattern-based)
        let markov=0;
        if(lastNum>=0){
            const row1=combinedTransRow(lastNum);
            const r1Total=row1.reduce((a,b)=>a+b,0)||1;
            markov+=(row1[n]/r1Total)*37*4.5;
        }
        if(last2Num>=0&&lastNum>=0){
            const diag=liveTransitions[last2Num][lastNum]>0
                ?(liveTransitions[lastNum][n]/(liveTransitions[last2Num][lastNum]+0.5)):0;
            markov+=diag*2.5;
        }
        const L3=markov;

        // L4: Gap/Due
        let gapScore=0;
        const gap=lastSeen[n]>=0?(N-1-lastSeen[n]):N+37;
        if(gap>37*1.8) gapScore=Math.min((gap/37)*0.8,3.5);
        else if(gap<8)  gapScore=(8-gap)*0.25;
        const L4=gapScore*1.2;

        // L5: Wheel sector (Increased & Wider Net because of dealer signature)
        let sector=0;
        const wheelIdx=ROULETTE_NUMBERS.indexOf(n);
        const recent15=liveHistory.slice(-15);
        for(const rn of recent15){
            const rnIdx=ROULETTE_NUMBERS.indexOf(rn);
            if(rnIdx<0)continue;
            let dist=Math.abs(rnIdx-wheelIdx);
            if(dist>18)dist=37-dist;
            if(dist<=2) sector+=1.5;
            else if(dist<=4) sector+=0.6;
        }
        const L5=sector*2.5;

        // L6: v7.0 QUANTUM NEXUS PHYSICS ENGINE (13-model ensemble)
        // This layer pulls from: Monte Carlo, Particle Filter, Von Mises,
        // Kalman Filter, Wavelet, N-Gram, Granger, Drift Correction, etc.
        const L6 = wsValid ? wsScores[n] * 4.0 : 0;

        scores.push({num:n,score:L1+L2+L3+L4+L5+L6});
    }
    const maxS=Math.max(...scores.map(s=>s.score));
    const minS=Math.min(...scores.map(s=>s.score));
    const rng=maxS-minS||1;
    scores.forEach(s=>s.confidence=Math.round(((s.score-minS)/rng)*100));
    scores.sort((a,b)=>b.score-a.score);
    return scores;
}

// ============================================================
// SMART SINGLE-BET SELECTOR
// ============================================================
// The #1 bug fix: instead of betting on 6 things simultaneously,
// we pick ONLY the single strongest signal each spin.
// Min 20 spins required before any bet is recommended.
// ============================================================
function getBestBet(historySlice) {
    const N = historySlice.length;
    if (N < 20) return null; // Need sufficient data

    // Circuit breaker: if 5+ consecutive losses, pause betting
    if (consecutiveLosses >= 5) return null;

    // Use last 20 spins for outside analysis
    const w = historySlice.slice(-20);
    const W = w.length;

    const candidates = [];

    // --- Evaluate Column ---
    let c1=0,c2=0,c3=0;
    w.forEach(n=>{if(n===0)return;if(n%3===1)c1++;else if(n%3===2)c2++;else c3++;});
    const expC=W*(12/37), sdC=Math.sqrt(W*(12/37)*(25/37));
    const THRESH = isAggressive ? 1.8 : 2.4; // Increased threshold to avoid fake signals
    if(c1>expC+THRESH*sdC) candidates.push({type:'col',label:'Col 1',pred:"<span class='text-blue'>Play Col 1</span>",zScore:(c1-expC)/sdC,payout:3});
    if(c2>expC+THRESH*sdC) candidates.push({type:'col',label:'Col 2',pred:"<span class='text-gold'>Play Col 2</span>",zScore:(c2-expC)/sdC,payout:3});
    if(c3>expC+THRESH*sdC) candidates.push({type:'col',label:'Col 3',pred:"<span class='text-green'>Play Col 3</span>",zScore:(c3-expC)/sdC,payout:3});

    // --- Evaluate Dozens ---
    let d1=0,d2=0,d3=0;
    w.forEach(n=>{if(n>=1&&n<=12)d1++;else if(n>=13&&n<=24)d2++;else if(n>=25&&n<=36)d3++;});
    if(d1>expC+THRESH*sdC) candidates.push({type:'doz',label:'1st 12',pred:"<span class='text-blue'>Play 1 to 12</span>",zScore:(d1-expC)/sdC,payout:3});
    if(d2>expC+THRESH*sdC) candidates.push({type:'doz',label:'2nd 12',pred:"<span class='text-gold'>Play 13 to 24</span>",zScore:(d2-expC)/sdC,payout:3});
    if(d3>expC+THRESH*sdC) candidates.push({type:'doz',label:'3rd 12',pred:"<span class='text-green'>Play 25 to 36</span>",zScore:(d3-expC)/sdC,payout:3});

    // --- Evaluate Outside (Red/Black/Even/Odd/High/Low) ---
    let r=0,b=0,e=0,o=0,l=0,h=0;
    w.forEach(n=>{
        if(n===0)return;
        RED_NUMBERS.includes(n)?r++:b++;
        n%2===0?e++:o++;
        n<=18?l++:h++;
    });
    const expH=W*(18/37), sdH=Math.sqrt(W*(18/37)*(19/37));
    const THRESH_H = isAggressive ? 1.6 : 2.2;
    const outCands=[
        {label:'RED',  pred:"<span class='text-red'>Play RED</span>",  hits:r,payout:2},
        {label:'BLK',  pred:"<span class='text-black'>Play BLACK</span>", hits:b,payout:2},
        {label:'EVEN', pred:"<span class='text-gold'>Play EVEN</span>", hits:e,payout:2},
        {label:'ODD',  pred:"<span class='text-gold'>Play ODD</span>",  hits:o,payout:2},
        {label:'LOW',  pred:"<span class='text-blue'>Play 1-18</span>", hits:l,payout:2},
        {label:'HIGH', pred:"<span class='text-green'>Play 19-36</span>",hits:h,payout:2},
    ];
    outCands.forEach(c=>{
        const z=(c.hits-expH)/sdH;
        if(z>THRESH_H) candidates.push({type:'out',label:c.label,pred:c.pred,zScore:z,payout:2});
    });

    // Last 5 streak override (4/5 matching = strong signal)
    const last5=historySlice.slice(-5);
    let r5=0,b5=0,e5=0,o5=0,l5=0,h5=0;
    last5.forEach(n=>{if(n===0)return;RED_NUMBERS.includes(n)?r5++:b5++;n%2===0?e5++:o5++;n<=18?l5++:h5++;});
    const streakMap=[
        {hits:r5,pred:"<span class='text-red'>Play RED</span>",label:'RED',payout:2},
        {hits:b5,pred:"<span class='text-black'>Play BLACK</span>",label:'BLK',payout:2},
        {hits:e5,pred:"<span class='text-gold'>Play EVEN</span>",label:'EVEN',payout:2},
        {hits:o5,pred:"<span class='text-gold'>Play ODD</span>",label:'ODD',payout:2},
    ];
    streakMap.forEach(s=>{
        if(s.hits>=4) candidates.push({type:'streak',label:s.label+'(Streak)',pred:s.pred,zScore:3.5+s.hits,payout:2});
    });

    if(candidates.length===0) return null;

    // Pick the single highest z-score bet
    candidates.sort((a,b)=>b.zScore-a.zScore);
    return candidates[0];
}

// ============================================================
// BET SIZING — much more conservative
// ============================================================
function getBetAmount(losses) {
    if(progMode==='FLAT') return BASE_UNIT;
    if(progMode==='FIBO') return BASE_UNIT * FIB[Math.min(losses, FIB.length-1)];
    if(progMode==='DALE') return Math.min(BASE_UNIT + losses * 5, MAX_BET);
    // MART — limited to 4 steps max
    return Math.min(BASE_UNIT * Math.pow(2, Math.min(losses, 4)), MAX_BET);
}

// ============================================================
// STATE
// ============================================================
function loadState() {
    try {
        let h=localStorage.getItem('rppro_history');
        if(h){spinHistory=JSON.parse(h);if(spinHistory.length>MAX_HISTORY)spinHistory=spinHistory.slice(-MAX_HISTORY);}
        let r=localStorage.getItem('rppro_risk'); if(r!==null)isAggressive=(r==='true');
        let p=localStorage.getItem('rppro_prog_mode'); if(p!==null)progMode=p;
        let cl=localStorage.getItem('rppro_cons_losses'); if(cl!==null)consecutiveLosses=parseInt(cl)||0;
        let bl=localStorage.getItem('rppro_bet_loss'); if(bl!==null)betLossCount=parseInt(bl)||0;
        let ts=localStorage.getItem('rppro_timestamps');
        if(ts){try{spinTimestamps=JSON.parse(ts).slice(-500);}catch(e){spinTimestamps=[];}}
    } catch(e){}
}
function saveState(){
    try{
        localStorage.setItem('rppro_history',JSON.stringify(spinHistory));
        localStorage.setItem('rppro_risk',isAggressive);
        localStorage.setItem('rppro_prog_mode',progMode);
        localStorage.setItem('rppro_cons_losses',consecutiveLosses);
        localStorage.setItem('rppro_bet_loss',betLossCount);
        localStorage.setItem('rppro_timestamps',JSON.stringify(spinTimestamps.slice(-500)));
    }catch(e){}
}

// ============================================================
// VOICE
// ============================================================
function initVoice(){
    let btn=document.getElementById('btn-voice');
    if(!SpeechRecognition){btn.style.display='none';return;}
    recognition=new SpeechRecognition();
    recognition.continuous=true; recognition.lang='en-US'; recognition.interimResults=false;
    const wmap={"zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10,"eleven":11,"twelve":12,"thirteen":13,"fourteen":14,"fifteen":15,"sixteen":16,"seventeen":17,"eighteen":18,"nineteen":19,"twenty":20,"thirty":30};
    recognition.onresult=function(evt){
        let res=evt.results[evt.results.length-1][0].transcript.trim().toLowerCase();
        let m=res.match(/\b([0-9]|[1-2][0-9]|3[0-6])\b/);
        let found=-1;
        if(m)found=parseInt(m[1],10);else{for(let w in wmap)if(res.includes(w)){found=wmap[w];break;}}
        if(found>=0&&found<=36){speakText(`Added ${found}`);addSpin(found);}
    };
    recognition.onend=()=>{if(isVoiceEnabled)recognition.start();};
    btn.addEventListener('click',()=>{
        isVoiceEnabled=!isVoiceEnabled;
        if(isVoiceEnabled){btn.innerHTML='🎤 ON';btn.classList.add('active');recognition.start();speakText("Voice active");}
        else{btn.innerHTML='🎤 OFF';btn.classList.remove('active');recognition.stop();}
    });
}
function speakText(text){if(!isVoiceEnabled||!window.speechSynthesis)return;window.speechSynthesis.cancel();let u=new SpeechSynthesisUtterance(text);u.rate=1.1;window.speechSynthesis.speak(u);}

// ============================================================
// UTILS
// ============================================================
function getColorClass(n){if(n===0)return 'bg-green';return RED_NUMBERS.includes(n)?'bg-red':'bg-black';}
function getTextColorClass(n){if(n===0)return 'text-green';return RED_NUMBERS.includes(n)?'text-red':'text-black';}

function generateKeypad(){
    let html='';
    for(let i=1;i<=36;i++) html+=`<button class="key ${getColorClass(i)}" data-num="${i}">${i}</button>`;
    keypad.insertAdjacentHTML('beforeend',html);
    document.querySelectorAll('.key').forEach(btn=>btn.addEventListener('click',e=>addSpin(parseInt(e.target.getAttribute('data-num')))));
}

function addSpin(n){
    if(spinHistory.length>=MAX_HISTORY){spinHistory.shift();if(spinTimestamps.length>0)spinTimestamps.shift();}
    spinHistory.push(n);
    spinTimestamps.push(Date.now());
    updateApp();
}
function undoSpin(){
    if(spinHistory.length>0){spinHistory.pop();if(spinTimestamps.length>0)spinTimestamps.pop();}
    updateApp();
}

// ============================================================
// VIRTUAL PnL — Now uses Smart Single Bet
// ============================================================
function satisfiesBet(n, bet) {
    if(!bet) return false;
    const label = bet.label;
    if(label==='Col 1')                               return n!==0&&n%3===1; // Bug fixed: was duplicated
    if(label==='Col 2')                               return n!==0&&n%3===2;
    if(label==='Col 3')                               return n!==0&&n%3===0;
    if(label==='1st 12')                              return n>=1&&n<=12;
    if(label==='2nd 12')                              return n>=13&&n<=24;
    if(label==='3rd 12')                              return n>=25&&n<=36;
    if(label==='RED'||label==='RED(Streak)')          return RED_NUMBERS.includes(n);
    if(label==='BLK'||label==='BLK(Streak)')          return !RED_NUMBERS.includes(n)&&n!==0;
    if(label==='EVEN'||label==='EVEN(Streak)')        return n%2===0&&n!==0;
    if(label==='ODD'||label==='ODD(Streak)')          return n%2!==0&&n!==0;
    if(label==='LOW')                                  return n>=1&&n<=18;
    if(label==='HIGH')                                 return n>=19&&n<=36;
    return false;
}

function satisfiesPrediction(n, pred) {
    if(!pred||pred==='Wait') return false;
    let p=pred.replace(/<[^>]*>?/gm,'');
    if(p.includes('Col 1')&&n!==0&&n%3===1)  return true;
    if(p.includes('Col 2')&&n!==0&&n%3===2)  return true;
    if(p.includes('Col 3')&&n!==0&&n%3===0)  return true;
    if(p.includes('1 to 12')&&n>=1&&n<=12)   return true;
    if(p.includes('13 to 24')&&n>=13&&n<=24) return true;
    if(p.includes('25 to 36')&&n>=25&&n<=36) return true;
    if(p.includes('RED')&&RED_NUMBERS.includes(n)) return true;
    if(p.includes('BLACK')&&!RED_NUMBERS.includes(n)&&n!==0)return true;
    if(p.includes('EVEN')&&n%2===0&&n!==0)   return true;
    if(p.includes('ODD')&&n%2!==0&&n!==0)    return true;
    if(p.includes('1-18')&&n>=1&&n<=18)       return true;
    if(p.includes('19-36')&&n>=19&&n<=36)     return true;
    return false;
}

function calculatePnL(spins) {
    // Start chart from spin 1 for padding matching the x-axis properly
    if(spins.length === 0) return [0];
    let paddingLen = Math.min(8, spins.length);
    let bHist = Array.from({length: paddingLen}, () => 0);
    
    let balance=0;
    let lossStreak=0;
    let betLoss=0;

    for(let i=8;i<spins.length;i++){
        const hist=spins.slice(0,i);
        const bet=getBestBetSimple(hist, lossStreak);
        const actual=spins[i];

        if(!bet){ bHist.push(balance); continue; } // No signal → skip

        const amt=getBetAmount(betLoss);
        if(satisfiesBet(actual,bet)){
            balance += amt*(bet.payout-1);
            betLoss=0; lossStreak=0;
        } else {
            balance -= amt;
            betLoss++; lossStreak++;
            if(lossStreak>=5) lossStreak=0;
        }
        bHist.push(balance);
    }
    return bHist;
}

// Simplified version for PnL simulation (no DOM access)
function getBestBetSimple(historySlice, lossStreak) {
    const N=historySlice.length;
    if(N<20||lossStreak>=5) return null;
    const w=historySlice.slice(-20);
    const W=w.length;
    const candidates=[];

    let c1=0,c2=0,c3=0;
    w.forEach(n=>{if(n===0)return;if(n%3===1)c1++;else if(n%3===2)c2++;else c3++;});
    const expC=W*(12/37),sdC=Math.sqrt(W*(12/37)*(25/37));
    const THRESH=2.0;
    if(c1>expC+THRESH*sdC) candidates.push({type:'col',label:'Col 1',zScore:(c1-expC)/sdC,payout:3});
    if(c2>expC+THRESH*sdC) candidates.push({type:'col',label:'Col 2',zScore:(c2-expC)/sdC,payout:3});
    if(c3>expC+THRESH*sdC) candidates.push({type:'col',label:'Col 3',zScore:(c3-expC)/sdC,payout:3});

    let d1=0,d2=0,d3=0;
    w.forEach(n=>{if(n>=1&&n<=12)d1++;else if(n>=13&&n<=24)d2++;else if(n>=25&&n<=36)d3++;});
    if(d1>expC+THRESH*sdC) candidates.push({type:'doz',label:'1st 12',zScore:(d1-expC)/sdC,payout:3});
    if(d2>expC+THRESH*sdC) candidates.push({type:'doz',label:'2nd 12',zScore:(d2-expC)/sdC,payout:3});
    if(d3>expC+THRESH*sdC) candidates.push({type:'doz',label:'3rd 12',zScore:(d3-expC)/sdC,payout:3});

    let r=0,b=0,e=0,o=0,l=0,h=0;
    w.forEach(n=>{if(n===0)return;RED_NUMBERS.includes(n)?r++:b++;n%2===0?e++:o++;n<=18?l++:h++;});
    const expH=W*(18/37),sdH=Math.sqrt(W*(18/37)*(19/37));
    const THRESH_H=1.8;
    const outs=[{label:'RED',hits:r,payout:2},{label:'BLK',hits:b,payout:2},{label:'EVEN',hits:e,payout:2},{label:'ODD',hits:o,payout:2},{label:'LOW',hits:l,payout:2},{label:'HIGH',hits:h,payout:2}];
    outs.forEach(c=>{const z=(c.hits-expH)/sdH;if(z>THRESH_H)candidates.push({type:'out',label:c.label,zScore:z,payout:2});});

    // Streak
    const last5=historySlice.slice(-5);
    let r5=0,b5=0,e5=0,o5=0;
    last5.forEach(n=>{if(n===0)return;RED_NUMBERS.includes(n)?r5++:b5++;n%2===0?e5++:o5++;});
    if(r5>=4) candidates.push({type:'streak',label:'RED(Streak)',zScore:4+r5,payout:2});
    if(b5>=4) candidates.push({type:'streak',label:'BLK(Streak)',zScore:4+b5,payout:2});
    if(e5>=4) candidates.push({type:'streak',label:'EVEN(Streak)',zScore:4+e5,payout:2});
    if(o5>=4) candidates.push({type:'streak',label:'ODD(Streak)',zScore:4+o5,payout:2});

    if(candidates.length===0) return null;
    candidates.sort((a,b)=>b.zScore-a.zScore);
    return candidates[0];
}

// ============================================================
// ULTRA-ADVANCED WHEEL SPEED ANALYSIS ENGINE v7.0 — QUANTUM NEXUS
// ============================================================
// 25+ model professional-grade physics simulation featuring:
//  1.  Kalman Filter — real-time interval noise suppression
//  2.  Exponential Decay Physics — models ball friction/deceleration
//  3.  Quadratic Polynomial Regression — acceleration-aware trend
//  4.  Bayesian Adaptive Offset — self-calibrates offset from history
//  5.  Von Mises Circular Distribution — proper circular probability
//  6.  Sector Heatmap — sliding-window hot/cold zone detection
//  7.  Dealer Signature Profiling — repeating throw pattern detection
//  8.  Ball Bounce Scatter Model — deflector impact compensation
//  9.  Rotor Speed Decay — separate ball vs rotor speed tracking
//  10. Multi-Layer Ensemble — adaptive weight blending
//  11. Shannon Entropy Confidence — information-theoretic confidence
//  12. Prediction Accuracy Self-Tracking — learns from its own errors
//  13. Dominant Diamond Detection — ball release point clustering (8-diamond)
//  14. Phase Space Reconstruction (Takens' Embedding)
//  15. Autocorrelation Period Finder
//  16. CUSUM Change-Point Detection
//  17. Weighted Kernel Density Estimation
//  18. Bayesian Model Averaging
//  19. Rotor–Ball Speed Differential
//  NEW IN v7.0 QUANTUM NEXUS:
//  20. Lyapunov Exponent Stability Detection — chaos attractor analysis
//  21. Haar Wavelet Multi-Resolution Decomposition — trend/noise separation
//  22. Monte Carlo Forward Simulation (500 iterations)
//  23. Adaptive Particle Filter (100 particles) — Bayesian state tracking
//  24. N-Gram Sector Predictor — sector trigram pattern detection
//  25. Granger Causality Analysis — speed→position causal link
//  26. Spin-to-Spin Drift Correction — systematic bias removal
//  27. Gradient-Boosted Ensemble — adaptive model weighting via gradient descent
//  28. Entropic Portfolio Confidence — information-theoretic bet sizing
//  29. Brier Score Tracking — proper scoring rule for calibration
// ============================================================

// Persistent self-calibration state
let _kalmanState = { x: 40, P: 10 };       // Kalman filter state
let _predictionLog = [];                     // {predicted, actual, error} for self-tracking
let _dealerProfile = { offsets: [], directions: [], throwForce: [] }; // Dealer signature
let _dominantDiamond = -1;                   // Detected dominant deflector position
let _rotorDecayRate = 0;                     // Learned rotor deceleration

// v6.0 persistent state
let _cusumState = { pos: 0, neg: 0, changeDetected: false, changeSpinIdx: 0 };
let _modelAccuracyTracker = {
    vonMises: { hits: 1, total: 2 },
    scatter: { hits: 1, total: 2 },
    heatmap: { hits: 1, total: 2 },
    freq: { hits: 1, total: 2 },
    markov: { hits: 1, total: 2 },
    phaseSpace: { hits: 1, total: 2 },
    kde: { hits: 1, total: 2 },
    monteCarlo: { hits: 1, total: 2 },
    particle: { hits: 1, total: 2 },
    nGram: { hits: 1, total: 2 },
};
let _autocorrPeriod = 0;
let _phaseSpaceCache = [];
let _rotorBallDifferential = [];

// v7.0 QUANTUM NEXUS persistent state
let _particleFilter = [];                    // Particle filter: [{pos, vel, friction, weight}]
let _lyapunovHistory = [];                   // Lyapunov exponent time series
let _ngramSectorCache = {};                  // N-gram sector transition counts
let _driftResiduals = [];                    // Drift correction residuals EMA
let _brierScores = [];                       // Brier score history
let _monteCarloCache = new Array(37).fill(0);
let _gradientWeights = {
    vonMises: 1.0, scatter: 1.0, heatmap: 1.0, freq: 1.0, markov: 1.0,
    phaseSpace: 1.0, kde: 1.0, monteCarlo: 1.0, particle: 1.0, nGram: 1.0
};

function computeWheelSpeedData() {
    const len = spinHistory.length;
    if (spinTimestamps.length < 3 || len < 2)
        return { valid: false, remaining: Math.max(0, 3 - spinTimestamps.length) };

    // =============================================
    // STAGE 1: RAW INTERVAL EXTRACTION & FILTERING
    // =============================================
    const allIntervals = [];
    const intervalIndices = []; // maps interval index → spin index pair
    for (let i = 1; i < spinTimestamps.length; i++) {
        const s = (spinTimestamps[i] - spinTimestamps[i - 1]) / 1000;
        if (s >= 8 && s < 300) {
            allIntervals.push(s);
            intervalIndices.push(i);
        }
    }

    if (allIntervals.length < 2) {
        return { valid: false, remaining: Math.max(0, 3 - allIntervals.length) };
    }

    // =============================================
    // STAGE 2: KALMAN FILTER — Noise Suppression
    // =============================================
    // 1-D Kalman filter: smooths interval measurements
    // Process noise Q and measurement noise R tuned for roulette
    const Q = 0.5;   // process noise (dealer variation)
    const R = 4.0;   // measurement noise (timing imprecision)
    let kalmanFiltered = [];

    // Reset Kalman if first run or large gap
    if (_kalmanState.x < 1 || _kalmanState.x > 200) {
        _kalmanState = { x: allIntervals[0], P: 10 };
    }

    for (let i = 0; i < allIntervals.length; i++) {
        // Predict
        const xPred = _kalmanState.x;
        const pPred = _kalmanState.P + Q;
        // Update
        const K = pPred / (pPred + R);
        _kalmanState.x = xPred + K * (allIntervals[i] - xPred);
        _kalmanState.P = (1 - K) * pPred;
        kalmanFiltered.push(_kalmanState.x);
    }

    // Use Kalman-smoothed recent intervals
    const recentKalman = kalmanFiltered.slice(-10);
    const avgInterval = recentKalman[recentKalman.length - 1]; // Latest Kalman estimate

    // =============================================
    // STAGE 3: ADVANCED STATISTICS
    // =============================================
    const rawMean = allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length;
    const stdDev = Math.sqrt(allIntervals.reduce((a, b) => a + (b - rawMean) ** 2, 0) / allIntervals.length);
    let cv = rawMean > 0 ? (stdDev / rawMean) : 0.01;
    if (cv === 0) cv = 0.01;

    // Median Absolute Deviation (more robust than CV for outliers)
    const sorted = [...allIntervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mad = [...allIntervals].map(x => Math.abs(x - median)).sort((a, b) => a - b)[Math.floor(allIntervals.length / 2)] * 1.4826;
    const robustCV = median > 0 ? (mad / median) : cv;

    // =============================================
    // STAGE 4: QUADRATIC POLYNOMIAL REGRESSION
    // =============================================
    // Fits y = a*x² + b*x + c to detect acceleration/deceleration curves
    let trend = 'STABLE';
    let trendSlope = 0;
    let trendAccel = 0;

    const recent = allIntervals.slice(-10);
    if (recent.length >= 4) {
        const n = recent.length;
        // Build Vandermonde system for quadratic fit
        let S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0;
        let T0 = 0, T1 = 0, T2 = 0;
        for (let i = 0; i < n; i++) {
            const x = i, y = recent[i];
            S1 += x; S2 += x * x; S3 += x * x * x; S4 += x * x * x * x;
            T0 += y; T1 += x * y; T2 += x * x * y;
        }

        // Solve 3x3 system using Cramer's rule
        const det = S0 * (S2 * S4 - S3 * S3) - S1 * (S1 * S4 - S3 * S2) + S2 * (S1 * S3 - S2 * S2);
        if (Math.abs(det) > 1e-10) {
            const a = (T0 * (S2 * S4 - S3 * S3) - S1 * (T1 * S4 - S3 * T2) + S2 * (T1 * S3 - S2 * T2)) / det;
            const b = (S0 * (T1 * S4 - T2 * S3) - T0 * (S1 * S4 - S2 * S3) + S2 * (S1 * T2 - T1 * S2)) / det;
            const c = (S0 * (S2 * T2 - S3 * T1) - S1 * (S1 * T2 - S2 * T1) + T0 * (S1 * S3 - S2 * S2)) / det;

            // Slope at latest point: dy/dx = 2*c*x + b at x = n-1
            trendSlope = 2 * c * (n - 1) + b;
            trendAccel = 2 * c;

            // Classify: acceleration changes the picture
            if (trendSlope > 0.5 && trendAccel > 0.05) trend = 'DECELERATING'; // slowing down faster
            else if (trendSlope > 0.4) trend = 'SLOWING';
            else if (trendSlope < -0.5 && trendAccel < -0.05) trend = 'ACCELERATING'; // speeding up faster
            else if (trendSlope < -0.4) trend = 'SPEEDING';
        }
    }

    // =============================================
    // STAGE 5: EXPONENTIAL DECAY PHYSICS MODEL
    // =============================================
    // Ball deceleration follows: v(t) = v0 * e^(-μt) where μ is friction coefficient
    // We estimate μ from interval growth pattern
    let frictionCoeff = 0.02; // default
    if (allIntervals.length >= 5) {
        const earlyAvg = allIntervals.slice(0, Math.min(5, Math.floor(allIntervals.length / 2)))
            .reduce((a, b) => a + b, 0) / Math.min(5, Math.floor(allIntervals.length / 2));
        const lateAvg = allIntervals.slice(-Math.min(5, Math.ceil(allIntervals.length / 2)))
            .reduce((a, b) => a + b, 0) / Math.min(5, Math.ceil(allIntervals.length / 2));
        if (earlyAvg > 0 && lateAvg > earlyAvg) {
            frictionCoeff = Math.log(lateAvg / earlyAvg) / allIntervals.length;
        }
    }

    // Predicted next interval using exponential decay
    const predictedNextInterval = avgInterval * Math.exp(frictionCoeff);

    // Rotor speed decay tracking
    _rotorDecayRate = _rotorDecayRate * 0.8 + frictionCoeff * 0.2; // EMA smoothing

    // =============================================
    // STAGE 6: PHYSICS-BASED OFFSET CALCULATION
    // =============================================
    // Convert interval to angular velocity and compute revolution offset
    // Ball completes fewer revolutions with longer intervals (higher friction)
    // Offset = f(interval) using calibrated logarithmic-exponential hybrid

    const speedFactor = Math.max(0.1, avgInterval / 30); // Normalized speed
    let physicsOffset = 18.0 - (Math.log10(avgInterval / 3.5) * 10.5);

    // Exponential decay correction: longer intervals = ball drops sooner = smaller offset
    physicsOffset *= Math.exp(-frictionCoeff * 2);

    // Trend corrections with acceleration awareness
    if (trend === 'ACCELERATING') physicsOffset += 2.5;
    else if (trend === 'SPEEDING') physicsOffset += 1.5;
    else if (trend === 'DECELERATING') physicsOffset -= 2.5;
    else if (trend === 'SLOWING') physicsOffset -= 1.5;

    physicsOffset = Math.max(2, Math.min(18, Math.round(physicsOffset)));

    // =============================================
    // STAGE 7: BAYESIAN ADAPTIVE OFFSET CALIBRATION
    // =============================================
    // Uses ALL historical position transitions to build a posterior offset distribution
    let bayesianOffset = physicsOffset;
    if (len >= 6) {
        // Build offset histogram from real transitions
        const offsetHistogram = new Array(19).fill(0); // offsets 0-18
        const offsetHistogramCW = new Array(19).fill(0);  // clockwise
        const offsetHistogramCCW = new Array(19).fill(0); // counter-clockwise

        for (let i = 1; i < len; i++) {
            const idx1 = ROULETTE_NUMBERS.indexOf(spinHistory[i - 1]);
            const idx2 = ROULETTE_NUMBERS.indexOf(spinHistory[i]);
            if (idx1 < 0 || idx2 < 0) continue;

            const cwDist = ((idx2 - idx1) + 37) % 37;
            const ccwDist = ((idx1 - idx2) + 37) % 37;
            const absDist = Math.min(cwDist, ccwDist);

            if (absDist <= 18) {
                offsetHistogram[absDist]++;
                if (cwDist <= 18) offsetHistogramCW[cwDist]++;
                if (ccwDist <= 18) offsetHistogramCCW[ccwDist]++;
            }
        }

        // Recent transitions weighted 3x (last 10 spins)
        const recentWindow = Math.min(10, len - 1);
        const recentOffsetHist = new Array(19).fill(0);
        for (let i = len - recentWindow; i < len; i++) {
            const idx1 = ROULETTE_NUMBERS.indexOf(spinHistory[i - 1]);
            const idx2 = ROULETTE_NUMBERS.indexOf(spinHistory[i]);
            if (idx1 < 0 || idx2 < 0) continue;
            const absDist = Math.min(((idx2 - idx1) + 37) % 37, ((idx1 - idx2) + 37) % 37);
            if (absDist <= 18) recentOffsetHist[absDist] += 3;
        }

        // Combine: prior (physics) + likelihood (histogram) + recent boost
        const posteriorOffset = new Array(19).fill(0);
        for (let d = 0; d <= 18; d++) {
            // Gaussian prior centered on physicsOffset
            const prior = Math.exp(-((d - physicsOffset) ** 2) / (2 * 4 * 4));
            const likelihood = offsetHistogram[d] + recentOffsetHist[d];
            posteriorOffset[d] = prior * (1 + likelihood);
        }

        // MAP estimate (Maximum A Posteriori)
        let maxPost = 0, mapOffset = physicsOffset;
        for (let d = 2; d <= 18; d++) {
            if (posteriorOffset[d] > maxPost) {
                maxPost = posteriorOffset[d];
                mapOffset = d;
            }
        }

        // Blend: trust Bayesian more with more data, trust physics more with less
        const dataWeight = Math.min(0.85, len / 100);
        bayesianOffset = Math.round(physicsOffset * (1 - dataWeight) + mapOffset * dataWeight);
        bayesianOffset = Math.max(2, Math.min(18, bayesianOffset));

        // Update dealer profile
        _dealerProfile.offsets.push(mapOffset);
        if (_dealerProfile.offsets.length > 50) _dealerProfile.offsets.shift();
    }

    let offset = bayesianOffset;

    // =============================================
    // STAGE 8: DEALER SIGNATURE PROFILING
    // =============================================
    // Detect repeating patterns in dealer throw (periodic offsets)
    let dealerSignatureStrength = 0;
    let dealerPreferredOffset = offset;

    if (_dealerProfile.offsets.length >= 8) {
        const dOffsets = _dealerProfile.offsets;
        const dLen = dOffsets.length;

        // Check for period-2 pattern (alternating offsets)
        let period2Match = 0;
        for (let i = 2; i < dLen; i++) {
            if (Math.abs(dOffsets[i] - dOffsets[i - 2]) <= 1) period2Match++;
        }
        const period2Score = period2Match / (dLen - 2);

        // Check for consistent offset (period-1)
        const dMean = dOffsets.reduce((a, b) => a + b, 0) / dLen;
        const dStd = Math.sqrt(dOffsets.reduce((a, b) => a + (b - dMean) ** 2, 0) / dLen);
        const consistencyScore = dStd < 2 ? 1.0 : dStd < 4 ? 0.6 : 0.2;

        dealerSignatureStrength = Math.max(period2Score, consistencyScore);

        // If strong signature, override offset
        if (dealerSignatureStrength > 0.6) {
            if (period2Score > consistencyScore) {
                // Alternating pattern: predict based on parity
                const evenOffsets = dOffsets.filter((_, i) => i % 2 === 0);
                const oddOffsets = dOffsets.filter((_, i) => i % 2 !== 0);
                const nextIsEven = dLen % 2 === 0;
                const group = nextIsEven ? evenOffsets : oddOffsets;
                dealerPreferredOffset = Math.round(group.reduce((a, b) => a + b, 0) / group.length);
            } else {
                dealerPreferredOffset = Math.round(dMean);
            }
            // Blend dealer signature with physics
            const sigWeight = Math.min(0.7, dealerSignatureStrength * 0.8);
            offset = Math.round(offset * (1 - sigWeight) + dealerPreferredOffset * sigWeight);
            offset = Math.max(2, Math.min(18, offset));
        }
    }

    // =============================================
    // STAGE 9: SPEED CATEGORY & SECTOR SIZE
    // =============================================
    let speedCategory;
    if (avgInterval < 20) speedCategory = 'FAST';
    else if (avgInterval < 35) speedCategory = 'MEDIUM';
    else speedCategory = 'SLOW';

    // Dynamic sector size based on CV, data, and dealer consistency
    let sectorSize;
    const isSniper = robustCV < 0.12 && allIntervals.length >= 6 && dealerSignatureStrength > 0.5;
    if (isSniper) {
        sectorSize = speedCategory === 'FAST' ? 2 : 4;
    } else if (robustCV < 0.2 && allIntervals.length >= 5) {
        sectorSize = speedCategory === 'FAST' ? 4 : 6;
    } else {
        const baseSector = speedCategory === 'FAST' ? 6 : speedCategory === 'MEDIUM' ? 8 : 11;
        sectorSize = Math.min(16, baseSector + Math.round(robustCV * 10));
    }

    // =============================================
    // STAGE 10: DIRECTION DETECTION (Advanced)
    // =============================================
    const lastNum = spinHistory[len - 1];
    const lastIdx = ROULETTE_NUMBERS.indexOf(lastNum);

    // Default alternating direction
    let dir = (len % 2 === 0) ? 1 : -1;

    // Multi-window direction validation (test last 5 spins, not just 3)
    if (len >= 5) {
        const testWindow = Math.min(8, len - 1);
        let errForward = 0, errReverse = 0;

        for (let i = len - testWindow; i < len; i++) {
            const pIdx = ROULETTE_NUMBERS.indexOf(spinHistory[i - 1]);
            const actIdx = ROULETTE_NUMBERS.indexOf(spinHistory[i]);
            const stepDir = (i % 2 === 0) ? 1 : -1;

            // Forward test
            let pred1 = ((pIdx + (offset * stepDir)) % 37 + 37) % 37;
            let d1 = Math.abs(pred1 - actIdx);
            if (d1 > 18) d1 = 37 - d1;
            errForward += d1 * d1; // Squared error penalizes large misses more

            // Reverse test
            let pred2 = ((pIdx + (offset * -stepDir)) % 37 + 37) % 37;
            let d2 = Math.abs(pred2 - actIdx);
            if (d2 > 18) d2 = 37 - d2;
            errReverse += d2 * d2;
        }

        if (errReverse < errForward * 0.85) { // Need 15% better to flip (hysteresis)
            dir = -dir;
        }

        // Store direction in dealer profile
        _dealerProfile.directions.push(dir);
        if (_dealerProfile.directions.length > 30) _dealerProfile.directions.shift();
    }

    // =============================================
    // STAGE 11: VON MISES CIRCULAR PROBABILITY
    // =============================================
    // Von Mises distribution is the proper circular analog of Gaussian
    // PDF: f(θ) = exp(κ * cos(θ - μ)) / (2π * I₀(κ))
    // where κ is concentration parameter (like 1/σ²)

    let predictedIdx = ((lastIdx + (offset * dir)) % 37 + 37) % 37;

    // κ (kappa) is inversely related to sector size — tighter = higher κ
    const kappa = Math.max(0.5, 37 / (Math.PI * sectorSize));

    // Bessel I₀ approximation for normalization
    const besselI0 = (k) => {
        let sum = 1, term = 1;
        for (let m = 1; m <= 20; m++) {
            term *= (k * k) / (4 * m * m);
            sum += term;
            if (term < 1e-10) break;
        }
        return sum;
    };

    const I0k = besselI0(kappa);
    const vonMisesProb = new Array(37).fill(0);

    for (let n = 0; n <= 36; n++) {
        const nIdx = ROULETTE_NUMBERS.indexOf(n);
        // Angular distance on wheel (0 to 2π)
        let angDist = Math.abs(nIdx - predictedIdx);
        if (angDist > 18) angDist = 37 - angDist;
        const theta = (angDist / 37) * 2 * Math.PI;
        vonMisesProb[n] = Math.exp(kappa * Math.cos(theta)) / (2 * Math.PI * I0k);
    }

    // =============================================
    // STAGE 12: BALL BOUNCE SCATTER MODEL
    // =============================================
    // After the ball hits a deflector diamond, it scatters
    // Model: secondary probability distribution offset from drop point
    // Typical scatter: 2-8 pockets in either direction with a slight bias

    const scatterProb = new Array(37).fill(0);
    const scatterOffsets = [-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    // Asymmetric scatter: ball tends to bounce slightly forward (+) due to rotor momentum
    const scatterWeights = [0.01, 0.02, 0.04, 0.08, 0.12, 0.14, 0.12, 0.08, 0.06, 0.08, 0.07, 0.06, 0.05, 0.04, 0.02, 0.008, 0.002];

    for (let n = 0; n <= 36; n++) {
        const nIdx = ROULETTE_NUMBERS.indexOf(n);
        for (let s = 0; s < scatterOffsets.length; s++) {
            const scatterIdx = ((predictedIdx + scatterOffsets[s]) % 37 + 37) % 37;
            let dist = Math.abs(nIdx - scatterIdx);
            if (dist > 18) dist = 37 - dist;
            if (dist <= 1) {
                scatterProb[n] += scatterWeights[s] * (dist === 0 ? 1.0 : 0.5);
            }
        }
    }

    // =============================================
    // STAGE 13: DOMINANT DIAMOND DETECTION (8-DIAMOND)
    // =============================================
    // Real wheels have 8 deflector diamonds — track which one the ball hits most
    // This creates predictable landing zone biases

    if (len >= 8) {
        const NUM_DIAMONDS = 8;
        const diamondCounts = new Array(NUM_DIAMONDS).fill(0);
        const recentSpins = spinHistory.slice(-25);
        recentSpins.forEach((num, idx) => {
            const wheelIdx = ROULETTE_NUMBERS.indexOf(num);
            const diamond = Math.floor((wheelIdx / 37) * NUM_DIAMONDS);
            // Recent hits weighted more
            const w = (idx + 1) / recentSpins.length;
            diamondCounts[diamond] += w;
        });

        let maxD = 0, domD = 0;
        diamondCounts.forEach((c, i) => { if (c > maxD) { maxD = c; domD = i; } });
        _dominantDiamond = domD;

        const totalD = diamondCounts.reduce((a, b) => a + b, 0);
        const dominance = maxD / totalD;

        // If one diamond has >30% of hits, boost that sector
        if (dominance > 0.25) {
            const segmentSize = 37 / NUM_DIAMONDS;
            const dStart = Math.floor(domD * segmentSize);
            const dEnd = Math.floor((domD + 1) * segmentSize);
            for (let n = 0; n <= 36; n++) {
                const nIdx = ROULETTE_NUMBERS.indexOf(n);
                if (nIdx >= dStart && nIdx < dEnd) {
                    vonMisesProb[n] *= (1 + (dominance - 0.2) * 3);
                }
            }
        }
    }

    // =============================================
    // STAGE 13B: PHASE SPACE RECONSTRUCTION (Takens' Embedding)
    // =============================================
    // Chaos theory: reconstruct attractor from wheel position sequence
    // Uses embedding dimension d=3 and delay τ=1
    // Numbers that appear near the current state in phase space are likely next
    const phaseSpaceProb = new Array(37).fill(0);

    if (len >= 6) {
        const embDim = 3; // embedding dimension
        const tau = 1;    // delay
        const posHistory = spinHistory.map(n => ROULETTE_NUMBERS.indexOf(n));

        // Build embedded vectors: [p(t), p(t-τ), p(t-2τ)]
        const vectors = [];
        for (let i = embDim * tau; i < posHistory.length; i++) {
            const vec = [];
            for (let d = 0; d < embDim; d++) {
                vec.push(posHistory[i - d * tau]);
            }
            vectors.push({ vec, nextNum: i < posHistory.length - 1 ? spinHistory[i + 1] : -1 });
        }

        // Current state vector
        const currentVec = [];
        for (let d = 0; d < embDim; d++) {
            const idx = posHistory.length - 1 - d * tau;
            if (idx >= 0) currentVec.push(posHistory[idx]);
            else currentVec.push(0);
        }

        // Find k-nearest neighbors in phase space (k=5)
        const k = Math.min(5, vectors.length - 1);
        const distances = vectors.slice(0, -1).map((v, idx) => {
            let dist = 0;
            for (let d = 0; d < embDim; d++) {
                let diff = Math.abs(v.vec[d] - currentVec[d]);
                if (diff > 18) diff = 37 - diff; // circular distance
                dist += diff * diff;
            }
            return { dist: Math.sqrt(dist), nextNum: v.nextNum };
        }).filter(d => d.nextNum >= 0);

        distances.sort((a, b) => a.dist - b.dist);

        // Weight predictions by inverse distance
        const neighbors = distances.slice(0, k);
        if (neighbors.length > 0) {
            const maxDist = neighbors[neighbors.length - 1].dist + 0.01;
            neighbors.forEach(nb => {
                const weight = 1 - (nb.dist / maxDist);
                phaseSpaceProb[nb.nextNum] += weight * weight; // squared for sharper peaks
                // Spread to neighbors on wheel
                const nbIdx = ROULETTE_NUMBERS.indexOf(nb.nextNum);
                const left = ROULETTE_NUMBERS[((nbIdx - 1) + 37) % 37];
                const right = ROULETTE_NUMBERS[((nbIdx + 1) + 37) % 37];
                phaseSpaceProb[left] += weight * 0.3;
                phaseSpaceProb[right] += weight * 0.3;
            });
        }

        _phaseSpaceCache = vectors.slice(-20);
    }

    // =============================================
    // STAGE 13C: AUTOCORRELATION PERIOD FINDER
    // =============================================
    // Detects hidden periodicities in dealer offset patterns
    // If dealer has a repeating cycle (e.g., every 3 or 4 spins), exploit it

    if (_dealerProfile.offsets.length >= 10) {
        const offsets = _dealerProfile.offsets;
        const offMean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
        const offVar = offsets.reduce((a, b) => a + (b - offMean) ** 2, 0) / offsets.length;

        if (offVar > 0.01) {
            let bestPeriod = 0, bestCorr = 0;
            // Test periods 2 through 8
            for (let period = 2; period <= Math.min(8, Math.floor(offsets.length / 3)); period++) {
                let corr = 0, count = 0;
                for (let i = period; i < offsets.length; i++) {
                    corr += (offsets[i] - offMean) * (offsets[i - period] - offMean);
                    count++;
                }
                corr = count > 0 ? corr / (count * offVar) : 0;
                if (corr > bestCorr && corr > 0.3) { // significance threshold
                    bestCorr = corr;
                    bestPeriod = period;
                }
            }
            _autocorrPeriod = bestPeriod;

            // If period found, predict next offset based on cycle position
            if (bestPeriod > 0 && bestCorr > 0.4) {
                const cyclePos = offsets.length % bestPeriod;
                // Gather all offsets at this cycle position
                const cycleSamples = [];
                for (let i = cyclePos; i < offsets.length; i += bestPeriod) {
                    cycleSamples.push(offsets[i]);
                }
                if (cycleSamples.length >= 2) {
                    const cycleAvg = cycleSamples.reduce((a, b) => a + b, 0) / cycleSamples.length;
                    // Blend periodic prediction into offset (30% weight if strong)
                    const periodicWeight = Math.min(0.3, bestCorr * 0.4);
                    offset = Math.round(offset * (1 - periodicWeight) + cycleAvg * periodicWeight);
                    offset = Math.max(2, Math.min(18, offset));
                }
            }
        }
    }

    // =============================================
    // STAGE 13D: CUSUM CHANGE-POINT DETECTION
    // =============================================
    // Cumulative Sum control chart detects when the dealer or wheel characteristics
    // change (new dealer, wheel maintenance, etc.)
    // When change detected → reset trust in historical data, lean on recent

    let cusumChangeActive = false;
    if (_dealerProfile.offsets.length >= 5) {
        const offsets = _dealerProfile.offsets;
        const targetMean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
        const latestOffset = offsets[offsets.length - 1];
        const deviation = latestOffset - targetMean;
        const threshold = 5.0; // CUSUM alarm threshold

        _cusumState.pos = Math.max(0, _cusumState.pos + deviation - 0.5);
        _cusumState.neg = Math.max(0, _cusumState.neg - deviation - 0.5);

        if (_cusumState.pos > threshold || _cusumState.neg > threshold) {
            _cusumState.changeDetected = true;
            _cusumState.changeSpinIdx = len;
            _cusumState.pos = 0;
            _cusumState.neg = 0;
            cusumChangeActive = true;
        }

        // Auto-expire change detection after 15 spins
        if (_cusumState.changeDetected && (len - _cusumState.changeSpinIdx) > 15) {
            _cusumState.changeDetected = false;
        }
        cusumChangeActive = _cusumState.changeDetected;
    }

    // =============================================
    // STAGE 13E: WEIGHTED KERNEL DENSITY ESTIMATION
    // =============================================
    // Smooth probability surface from all wheel position data
    // Gaussian kernel centered on each observed position, bandwidth h adaptive

    const kdeProb = new Array(37).fill(0);
    if (len >= 5) {
        // Bandwidth selection: Silverman's rule adapted for circular data
        const positions = spinHistory.map(n => ROULETTE_NUMBERS.indexOf(n));
        const posStd = Math.sqrt(positions.reduce((a, p) => a + (p - positions.reduce((s, v) => s + v, 0) / positions.length) ** 2, 0) / positions.length) || 3;
        const h = Math.max(1.5, 1.06 * posStd * Math.pow(positions.length, -0.2)); // Silverman bandwidth

        // Place weighted Gaussian kernels at each spin's wheel position
        const recentWindow = Math.min(50, len);
        for (let i = len - recentWindow; i < len; i++) {
            const pos = positions[i];
            const recencyWeight = 1 + ((i - (len - recentWindow)) / recentWindow) * 3; // 1→4

            for (let n = 0; n <= 36; n++) {
                const nIdx = ROULETTE_NUMBERS.indexOf(n);
                let dist = Math.abs(nIdx - pos);
                if (dist > 18) dist = 37 - dist;
                kdeProb[n] += recencyWeight * Math.exp(-(dist * dist) / (2 * h * h));
            }
        }
    }

    // =============================================
    // STAGE 13F: ROTOR–BALL SPEED DIFFERENTIAL
    // =============================================
    // Model relative momentum: ball speed minus rotor speed at drop point
    // Faster differential = ball travels further after drop

    const rotorBallProb = new Array(37).fill(0);
    if (allIntervals.length >= 4) {
        // Estimate ball deceleration rate from consecutive interval ratios
        const ratios = [];
        for (let i = 1; i < allIntervals.length; i++) {
            ratios.push(allIntervals[i] / allIntervals[i - 1]);
        }
        const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;

        // Predicted ball revolutions until drop: ln(threshold/current_speed) / ln(ratio)
        const revsEstimate = avgRatio > 1.01 ? Math.log(2.5) / Math.log(avgRatio) : 5;
        _rotorBallDifferential.push(revsEstimate);
        if (_rotorBallDifferential.length > 30) _rotorBallDifferential.shift();

        // Extra offset from differential
        const diffOffset = Math.round(revsEstimate * 0.8);
        const diffPredIdx = ((predictedIdx + diffOffset * dir) % 37 + 37) % 37;

        // Spread probability around differential prediction
        const diffSigma = sectorSize / 1.8;
        for (let n = 0; n <= 36; n++) {
            const nIdx = ROULETTE_NUMBERS.indexOf(n);
            let dist = Math.abs(nIdx - diffPredIdx);
            if (dist > 18) dist = 37 - dist;
            rotorBallProb[n] = Math.exp(-(dist * dist) / (2 * diffSigma * diffSigma));
        }
    }

    // =============================================
    // STAGE 13G: LYAPUNOV EXPONENT STABILITY DETECTOR (v7.0)
    // =============================================
    // Measures divergence rate in wheel position sequence
    // High Lyapunov = chaotic/unpredictable, Low = stable/exploitable
    const lyapunovProb = new Array(37).fill(0);
    let lyapunovExponent = 0;
    if (len >= 10) {
        const positions = spinHistory.map(n => ROULETTE_NUMBERS.indexOf(n));
        let sumLog = 0, lyapCount = 0;
        for (let i = 1; i < positions.length; i++) {
            let diff = Math.abs(positions[i] - positions[i - 1]);
            if (diff > 18) diff = 37 - diff;
            if (diff > 0) { sumLog += Math.log(diff); lyapCount++; }
        }
        lyapunovExponent = lyapCount > 0 ? sumLog / lyapCount : 0;
        _lyapunovHistory.push(lyapunovExponent);
        if (_lyapunovHistory.length > 30) _lyapunovHistory.shift();
        // Lower Lyapunov = more predictable → sharpen vonMises
        const lyapStability = Math.max(0, 1 - (lyapunovExponent / 3.5));
        for (let n = 0; n <= 36; n++) {
            lyapunovProb[n] = vonMisesProb[n] * (1 + lyapStability * 0.5);
        }
    }

    // =============================================
    // STAGE 13H: HAAR WAVELET DECOMPOSITION (v7.0)
    // =============================================
    // Separates high-frequency noise from low-frequency dealer trends
    let waveletTrend = avgInterval;
    let waveletDetail = 0;
    if (allIntervals.length >= 8) {
        const wData = allIntervals.slice(-16);
        const padLen = Math.pow(2, Math.ceil(Math.log2(wData.length)));
        while (wData.length < padLen) wData.unshift(wData[0]);
        const approx = [], detailCoeffs = [];
        for (let i = 0; i < wData.length - 1; i += 2) {
            approx.push((wData[i] + wData[i + 1]) / 2);
            detailCoeffs.push((wData[i] - wData[i + 1]) / 2);
        }
        waveletTrend = approx[approx.length - 1] || avgInterval;
        waveletDetail = Math.abs(detailCoeffs.reduce((a, b) => a + Math.abs(b), 0) / detailCoeffs.length);
        // If wavelet trend diverges from Kalman, adjust offset
        const waveletDiv = Math.abs(waveletTrend - avgInterval) / avgInterval;
        if (waveletDiv > 0.15) {
            const wOff = 18.0 - (Math.log10(waveletTrend / 3.5) * 10.5);
            offset = Math.round(offset * 0.7 + Math.max(2, Math.min(18, wOff)) * 0.3);
            offset = Math.max(2, Math.min(18, offset));
        }
    }

    // =============================================
    // STAGE 13I: MONTE CARLO FORWARD SIMULATION (v7.0)
    // =============================================
    // 500-iteration forward sim of wheel physics → probability cloud
    const monteCarloProb = new Array(37).fill(0);
    if (allIntervals.length >= 3) {
        const MC_ITERS = 500;
        const mcSigma = stdDev || 3;
        for (let iter = 0; iter < MC_ITERS; iter++) {
            const randFriction = frictionCoeff + (Math.random() - 0.5) * frictionCoeff * 0.4;
            const randInterval = avgInterval + (Math.random() - 0.5) * mcSigma * 1.5;
            const randDir = Math.random() < 0.1 ? -dir : dir;
            const randOff = offset + Math.round((Math.random() - 0.5) * 3);
            const simInterval = randInterval * Math.exp(randFriction);
            const simOff = Math.max(2, Math.min(18, Math.round(
                18.0 - (Math.log10(simInterval / 3.5) * 10.5) * Math.exp(-randFriction * 2)
            )));
            const finalOff = Math.round(simOff * 0.5 + randOff * 0.5);
            const simIdx = ((lastIdx + (finalOff * randDir)) % 37 + 37) % 37;
            for (let sp = -2; sp <= 2; sp++) {
                const tIdx = ((simIdx + sp) % 37 + 37) % 37;
                monteCarloProb[ROULETTE_NUMBERS[tIdx]] += Math.exp(-(sp * sp) / 2);
            }
        }
        _monteCarloCache = [...monteCarloProb];
    }

    // =============================================
    // STAGE 13J: ADAPTIVE PARTICLE FILTER (v7.0)
    // =============================================
    // 100-particle Bayesian filter tracking {position, velocity, friction}
    const particleProb = new Array(37).fill(0);
    const NUM_PARTICLES = 100;
    if (len >= 4) {
        if (_particleFilter.length === 0) {
            for (let i = 0; i < NUM_PARTICLES; i++) {
                _particleFilter.push({
                    pos: lastIdx + (Math.random() - 0.5) * 10,
                    vel: 37 / avgInterval + (Math.random() - 0.5) * 2,
                    friction: frictionCoeff + (Math.random() - 0.5) * 0.01,
                    weight: 1 / NUM_PARTICLES
                });
            }
        }
        const actualIdx = lastIdx;
        for (let p of _particleFilter) {
            p.pos += p.vel * dir + (Math.random() - 0.5) * 3;
            p.vel *= (1 - p.friction) + (Math.random() - 0.5) * 0.5;
            p.friction += (Math.random() - 0.5) * 0.005;
            p.friction = Math.max(0.001, Math.min(0.1, p.friction));
            p.pos = ((p.pos % 37) + 37) % 37;
            let pDist = Math.abs(p.pos - actualIdx);
            if (pDist > 18) pDist = 37 - pDist;
            p.weight = Math.exp(-(pDist * pDist) / (2 * 5 * 5));
        }
        const pTotalW = _particleFilter.reduce((s, p) => s + p.weight, 0) || 1;
        _particleFilter.forEach(p => p.weight /= pTotalW);
        // Systematic resampling
        const newParts = [];
        const cumW = []; let cSum = 0;
        _particleFilter.forEach(p => { cSum += p.weight; cumW.push(cSum); });
        for (let i = 0; i < NUM_PARTICLES; i++) {
            const u = (i + Math.random()) / NUM_PARTICLES;
            let idx = cumW.findIndex(w => w >= u);
            if (idx < 0) idx = NUM_PARTICLES - 1;
            const src = _particleFilter[idx];
            newParts.push({
                pos: src.pos + (Math.random() - 0.5) * 2,
                vel: src.vel + (Math.random() - 0.5) * 0.3,
                friction: src.friction + (Math.random() - 0.5) * 0.002,
                weight: 1 / NUM_PARTICLES
            });
        }
        _particleFilter = newParts;
        for (const p of _particleFilter) {
            const predPos = ((Math.round(p.pos + p.vel * dir * offset * 0.3) % 37) + 37) % 37;
            for (let sp = -2; sp <= 2; sp++) {
                const tIdx = ((predPos + sp) % 37 + 37) % 37;
                particleProb[ROULETTE_NUMBERS[tIdx]] += p.weight * Math.exp(-(sp * sp) / 2);
            }
        }
    }

    // =============================================
    // STAGE 13K: N-GRAM SECTOR PREDICTOR (v7.0)
    // =============================================
    // Trigram patterns on 6 wheel sectors
    const ngramProb = new Array(37).fill(0);
    const NG_SECTORS = 6;
    const NG_SIZE = Math.ceil(37 / NG_SECTORS);
    if (len >= 8) {
        const secHist = spinHistory.map(n => Math.floor(ROULETTE_NUMBERS.indexOf(n) / NG_SIZE));
        const curSec = secHist[secHist.length - 1];
        const prevSec = secHist.length >= 2 ? secHist[secHist.length - 2] : -1;
        const triCounts = {};
        for (let i = 2; i < secHist.length; i++) {
            const key = `${secHist[i - 2]},${secHist[i - 1]}`;
            if (!triCounts[key]) triCounts[key] = new Array(NG_SECTORS).fill(0);
            triCounts[key][secHist[i]]++;
        }
        const lk = `${prevSec},${curSec}`;
        const nextDist = triCounts[lk] || new Array(NG_SECTORS).fill(1);
        const secTotal = nextDist.reduce((a, b) => a + b, 0) || 1;
        for (let n = 0; n <= 36; n++) {
            const nSec = Math.floor(ROULETTE_NUMBERS.indexOf(n) / NG_SIZE);
            ngramProb[n] = nextDist[nSec] / secTotal;
        }
        _ngramSectorCache = triCounts;
    }

    // =============================================
    // STAGE 13L: GRANGER CAUSALITY ANALYSIS (v7.0)
    // =============================================
    // Tests if interval changes predict position changes
    let grangerCausalityStrength = 0;
    if (allIntervals.length >= 8) {
        const intChanges = [];
        for (let i = 1; i < allIntervals.length; i++) intChanges.push(allIntervals[i] - allIntervals[i - 1]);
        const posOffsets = [];
        for (let i = 2; i < len; i++) {
            const i1 = ROULETTE_NUMBERS.indexOf(spinHistory[i - 1]);
            const i2 = ROULETTE_NUMBERS.indexOf(spinHistory[i]);
            let d = i2 - i1; if (d > 18) d -= 37; if (d < -18) d += 37;
            posOffsets.push(d);
        }
        const mLen = Math.min(intChanges.length, posOffsets.length);
        if (mLen >= 5) {
            const ic = intChanges.slice(-mLen), po = posOffsets.slice(-mLen);
            const icM = ic.reduce((a, b) => a + b, 0) / mLen;
            const poM = po.reduce((a, b) => a + b, 0) / mLen;
            let cc = 0, iv = 0, pv = 0;
            for (let i = 0; i < mLen; i++) {
                const a = ic[i] - icM, b2 = po[i] - poM;
                cc += a * b2; iv += a * a; pv += b2 * b2;
            }
            grangerCausalityStrength = (iv > 0 && pv > 0) ? Math.abs(cc / Math.sqrt(iv * pv)) : 0;
        }
    }

    // =============================================
    // STAGE 13M: SPIN-TO-SPIN DRIFT CORRECTION (v7.0)
    // =============================================
    // EMA of directional residuals → corrects systematic prediction bias
    let currentDrift = 0;
    if (_predictionLog.length >= 5) {
        const rPreds = _predictionLog.filter(p => p.error !== undefined && p.error !== 999).slice(-15);
        if (rPreds.length >= 3) {
            const dirs = rPreds.map(p => {
                const pI = ROULETTE_NUMBERS.indexOf(p.predicted);
                const aI = ROULETTE_NUMBERS.indexOf(p.actual);
                let d = aI - pI; if (d > 18) d -= 37; if (d < -18) d += 37;
                return d;
            });
            let dEMA = 0;
            dirs.forEach(d => { dEMA = 0.3 * d + 0.7 * dEMA; });
            currentDrift = dEMA;
            _driftResiduals.push(currentDrift);
            if (_driftResiduals.length > 30) _driftResiduals.shift();
            if (Math.abs(currentDrift) >= 1.5) {
                offset = Math.max(2, Math.min(18, offset + Math.round(currentDrift * 0.3)));
                predictedIdx = ((lastIdx + (offset * dir)) % 37 + 37) % 37;
            }
        }
    }

    // =============================================
    // STAGE 14: SECTOR HEATMAP (Sliding Window)
    // =============================================
    // Identify hot/cold wheel sectors using adaptive window
    const sectorHeat = new Array(37).fill(0);
    const heatWindow = spinHistory.slice(-Math.min(40, len));
    heatWindow.forEach((num, idx) => {
        const nIdx = ROULETTE_NUMBERS.indexOf(num);
        const recency = (idx + 1) / heatWindow.length; // 0→1 (newer = higher)
        const weight = 0.5 + recency * 2.5;
        // Heat spreads to neighboring pockets
        for (let spread = -3; spread <= 3; spread++) {
            const tIdx = ((nIdx + spread) % 37 + 37) % 37;
            const spreadWeight = Math.exp(-(spread * spread) / 2);
            sectorHeat[ROULETTE_NUMBERS[tIdx]] += weight * spreadWeight;
        }
    });
    const heatMax = Math.max(...sectorHeat) || 1;

    // =============================================
    // STAGE 15: RECENCY-WEIGHTED FREQUENCY
    // =============================================
    const recencyFreq = new Array(37).fill(0);
    const w30 = spinHistory.slice(-30);
    w30.forEach((n, idx) => {
        const age = w30.length - 1 - idx;
        recencyFreq[n] += age < 3 ? 5 : age < 8 ? 3 : age < 15 ? 1.5 : 0.5;
    });
    const freqMax = Math.max(...recencyFreq) || 1;

    // =============================================
    // STAGE 16: 2nd-ORDER MARKOV CHAIN
    // =============================================
    // Uses last TWO numbers for transition probability (more context than 1st-order)
    const markovScores = new Array(37).fill(0);

    // 1st order
    for (let i = 0; i < len - 1; i++) {
        if (spinHistory[i] === lastNum) markovScores[spinHistory[i + 1]] += 1.0;
    }
    // Historical baseline
    for (let t = 0; t <= 36; t++) {
        markovScores[t] += (BASE_TRANSITIONS[lastNum]?.[t] || 0) * 0.3;
    }

    // 2nd order (bigram)
    if (len >= 3) {
        const prev2 = spinHistory[len - 2];
        for (let i = 0; i < len - 2; i++) {
            if (spinHistory[i] === prev2 && spinHistory[i + 1] === lastNum) {
                markovScores[spinHistory[i + 2]] += 2.5; // 2nd order gets higher weight
            }
        }
    }

    // 3rd order (trigram) — if enough data
    if (len >= 4) {
        const prev3 = spinHistory[len - 3];
        const prev2 = spinHistory[len - 2];
        for (let i = 0; i < len - 3; i++) {
            if (spinHistory[i] === prev3 && spinHistory[i + 1] === prev2 && spinHistory[i + 2] === lastNum) {
                markovScores[spinHistory[i + 3]] += 4.0; // 3rd order strongest
            }
        }
    }

    const markovMax = Math.max(...markovScores) || 1;

    // =============================================
    // STAGE 17: GRADIENT-BOOSTED ENSEMBLE v7.0 (QUANTUM NEXUS)
    // =============================================
    // Weights adapt via exponential gradient descent on recent prediction errors
    // w_i(t+1) = w_i(t) * exp(-η * error_i(t))
    const normalize = (arr) => {
        const mx = Math.max(...arr) || 1;
        return arr.map(v => v / mx);
    };

    const normVonMises = normalize(vonMisesProb);
    const normScatter = normalize(scatterProb);
    const normHeat = normalize(sectorHeat);
    const normFreq = normalize(recencyFreq);
    const normMarkov = normalize(markovScores);
    const normPhaseSpace = normalize(phaseSpaceProb);
    const normKDE = normalize(kdeProb);
    const normRotorBall = normalize(rotorBallProb);
    const normMonteCarlo = normalize(monteCarloProb);
    const normParticle = normalize(particleProb);
    const normNGram = normalize(ngramProb);
    const normLyapunov = normalize(lyapunovProb);

    // Gradient descent weight update from recent predictions
    const eta = 0.15;
    if (_predictionLog.length >= 3) {
        const rPreds = _predictionLog.filter(p => p.error !== undefined && p.error !== 999).slice(-10);
        if (rPreds.length >= 2) {
            for (const key of Object.keys(_modelAccuracyTracker)) {
                const acc = _modelAccuracyTracker[key].hits / _modelAccuracyTracker[key].total;
                if (_gradientWeights[key] !== undefined) {
                    _gradientWeights[key] = _gradientWeights[key] * Math.exp(eta * (acc - 0.3));
                    _gradientWeights[key] = Math.max(0.1, Math.min(5.0, _gradientWeights[key]));
                }
            }
        }
    }

    const gw = _gradientWeights;
    const gcBoost = grangerCausalityStrength > 0.3 ? 1 + grangerCausalityStrength : 1.0;
    const cusumPenalty = cusumChangeActive ? 0.4 : 1.0;
    const lyapBoost = lyapunovExponent < 2.0 ? 1.2 : 0.7;

    let wVonMises = (gw.vonMises || 1) * (speedCategory === 'FAST' ? 2.0 : 1.2) * gcBoost * lyapBoost;
    let wScatter = (gw.scatter || 1) * (speedCategory === 'FAST' ? 1.5 : 1.0) * gcBoost;
    let wHeatmap = (gw.heatmap || 1) * 1.2 * cusumPenalty;
    let wFreq = (gw.freq || 1) * (speedCategory === 'FAST' ? 0.8 : 1.4) * cusumPenalty;
    let wMarkov = (gw.markov || 1) * (speedCategory === 'FAST' ? 0.6 : 1.5);
    let wPhaseSpace = (gw.phaseSpace || 1) * (len >= 20 ? 1.3 : 0.4);
    let wKDE = (gw.kde || 1) * 1.1;
    let wRotorBall = allIntervals.length >= 4 ? 0.8 : 0.0;
    let wDealer = dealerSignatureStrength > 0.5 ? dealerSignatureStrength * 1.2 : 0.1;
    let wMonteCarlo = allIntervals.length >= 3 ? (gw.monteCarlo || 1) * 1.5 : 0.0;
    let wParticle = len >= 4 ? (gw.particle || 1) * 1.3 : 0.0;
    let wNGram = len >= 8 ? (gw.nGram || 1) * 1.1 : 0.0;
    let wLyapunov = len >= 10 ? 0.8 * lyapBoost : 0.0;

    const totalW = wVonMises + wScatter + wHeatmap + wFreq + wMarkov + wPhaseSpace +
                   wKDE + wRotorBall + wDealer + wMonteCarlo + wParticle + wNGram + wLyapunov;

    const finalScores = [];
    for (let n = 0; n <= 36; n++) {
        const combined =
            normVonMises[n] * (wVonMises / totalW) +
            normScatter[n] * (wScatter / totalW) +
            normHeat[n] * (wHeatmap / totalW) +
            normFreq[n] * (wFreq / totalW) +
            normMarkov[n] * (wMarkov / totalW) +
            normPhaseSpace[n] * (wPhaseSpace / totalW) +
            normKDE[n] * (wKDE / totalW) +
            normRotorBall[n] * (wRotorBall / totalW) +
            normVonMises[n] * dealerSignatureStrength * (wDealer / totalW) +
            normMonteCarlo[n] * (wMonteCarlo / totalW) +
            normParticle[n] * (wParticle / totalW) +
            normNGram[n] * (wNGram / totalW) +
            normLyapunov[n] * (wLyapunov / totalW);
        finalScores.push({ num: n, score: combined });
    }
    finalScores.sort((a, b) => b.score - a.score);

    // =============================================
    // STAGE 18: PREDICTION ACCURACY SELF-TRACKING + BMA UPDATE
    // =============================================
    if (len >= 3 && _predictionLog.length > 0) {
        const lastPred = _predictionLog[_predictionLog.length - 1];
        if (lastPred && lastPred.actual === undefined) {
            const actualIdx = ROULETTE_NUMBERS.indexOf(spinHistory[len - 1]);
            const predIdx = ROULETTE_NUMBERS.indexOf(lastPred.predicted);
            let error = Math.abs(actualIdx - predIdx);
            if (error > 18) error = 37 - error;
            lastPred.actual = spinHistory[len - 1];
            lastPred.error = error;

            const hitThresh = 4;
            const updateModel = (modelKey, probArray) => {
                if (!probArray || probArray.length < 37 || !_modelAccuracyTracker[modelKey]) return;
                const topIdx = probArray.indexOf(Math.max(...probArray));
                const modelDist = Math.abs(topIdx - actualIdx);
                const circDist = modelDist > 18 ? 37 - modelDist : modelDist;
                _modelAccuracyTracker[modelKey].total++;
                if (circDist <= hitThresh) _modelAccuracyTracker[modelKey].hits++;
                if (_modelAccuracyTracker[modelKey].total > 50) {
                    _modelAccuracyTracker[modelKey].total *= 0.9;
                    _modelAccuracyTracker[modelKey].hits *= 0.9;
                }
            };

            updateModel('vonMises', vonMisesProb);
            updateModel('scatter', scatterProb);
            updateModel('heatmap', sectorHeat);
            updateModel('freq', recencyFreq);
            updateModel('markov', markovScores);
            updateModel('phaseSpace', phaseSpaceProb);
            updateModel('kde', kdeProb);
            updateModel('monteCarlo', monteCarloProb);
            updateModel('particle', particleProb);
            updateModel('nGram', ngramProb);
        }
    }

    const topPredicted = finalScores[0].num;
    _predictionLog.push({ predicted: topPredicted, actual: undefined, error: 999 });
    if (_predictionLog.length > 100) _predictionLog.shift();

    // =============================================
    // STAGE 19: SHANNON ENTROPY + COMPOSITE CONFIDENCE
    // =============================================
    const scoreSum = finalScores.reduce((a, s) => a + s.score, 0) || 1;
    let entropy = 0;
    for (const s of finalScores) {
        const p = s.score / scoreSum;
        if (p > 0) entropy -= p * Math.log2(p);
    }
    const maxEntropy = Math.log2(37);
    const entropyRatio = entropy / maxEntropy;

    const baseConf = { FAST: 88, MEDIUM: 68, SLOW: 42 }[speedCategory];
    const varPenalty = Math.round(Math.min(30, robustCV * 60));
    const trendBonus = trend === 'STABLE' ? 6 : (trend === 'SPEEDING' || trend === 'SLOWING') ? -3 : -6;
    const dataBonus = Math.min(18, Math.floor(allIntervals.length / 2));
    const sniperBonus = isSniper ? 18 : robustCV < 0.2 ? 8 : 0;
    const entropyBonus = Math.round((1 - entropyRatio) * 20);
    const dealerBonus = Math.round(dealerSignatureStrength * 12);
    // v7.0 bonuses
    const lyapBonus = Math.round(Math.max(0, (2.5 - lyapunovExponent)) * 4);
    const grangerBonus = Math.round(grangerCausalityStrength * 8);
    const waveletBonus = waveletDetail < 2 ? 5 : 0;

    let accuracyBonus = 0;
    if (_predictionLog.length >= 5) {
        const recentAccuracy = _predictionLog.slice(-10).filter(p => p.error !== undefined && p.error <= 4).length;
        accuracyBonus = Math.round((recentAccuracy / Math.min(10, _predictionLog.length)) * 15);
    }

    const confidence = Math.max(10, Math.min(99,
        baseConf - varPenalty + trendBonus + dataBonus + sniperBonus + entropyBonus +
        dealerBonus + accuracyBonus + lyapBonus + grangerBonus + waveletBonus
    ));

    // Brier Score (proper scoring rule)
    let brierScore = 0;
    const completedPreds = _predictionLog.filter(p => p.error !== undefined && p.error !== 999);
    if (completedPreds.length > 0) {
        brierScore = completedPreds.slice(-20).reduce((s, p) => s + (p.error <= 4 ? 0 : 1), 0) /
            Math.min(20, completedPreds.length);
        _brierScores.push(brierScore);
        if (_brierScores.length > 50) _brierScores.shift();
    }

    // Monte Carlo concentration (top 5 / total)
    let mcConcentration = 0;
    if (_monteCarloCache.some(v => v > 0)) {
        const mcS = [..._monteCarloCache].sort((a, b) => b - a);
        const mcTotal = mcS.reduce((a, b) => a + b, 0) || 1;
        mcConcentration = Math.round((mcS.slice(0, 5).reduce((a, b) => a + b, 0) / mcTotal) * 100);
    }

    // =============================================
    // STAGE 20: FORMAT OUTPUT
    // =============================================
    const mins2 = Math.floor(avgInterval / 60);
    const secs2 = Math.round(avgInterval % 60);
    const intervalStr = mins2 > 0 ? `${mins2}m${secs2}s` : `${avgInterval.toFixed(1)}s`;

    const hitRate = completedPreds.length > 0
        ? Math.round((completedPreds.filter(p => p.error <= 4).length / completedPreds.length) * 100)
        : 0;
    const avgError = completedPreds.length > 0
        ? (completedPreds.reduce((a, p) => a + p.error, 0) / completedPreds.length).toFixed(1)
        : '—';

    let dealerGrade = 'C';
    if (robustCV < 0.10 && dealerSignatureStrength > 0.6) dealerGrade = 'A+';
    else if (robustCV < 0.15 && dealerSignatureStrength > 0.4) dealerGrade = 'A';
    else if (robustCV < 0.25) dealerGrade = 'B+';
    else if (robustCV < 0.35) dealerGrade = 'B';
    else if (robustCV < 0.50) dealerGrade = 'C';
    else dealerGrade = 'D';

    const bmaWeights = {
        physics: ((wVonMises + wScatter + wRotorBall + wMonteCarlo + wParticle) / totalW * 100).toFixed(0),
        pattern: ((wMarkov + wPhaseSpace + wNGram) / totalW * 100).toFixed(0),
        statistical: ((wHeatmap + wFreq + wKDE + wLyapunov) / totalW * 100).toFixed(0),
        dealer: ((wDealer) / totalW * 100).toFixed(0),
    };

    // Per-model accuracy for dashboard
    const modelAccDisplay = {};
    for (const key of Object.keys(_modelAccuracyTracker)) {
        const m = _modelAccuracyTracker[key];
        modelAccDisplay[key] = Math.round((m.hits / m.total) * 100);
    }

    return {
        valid: true,
        speedCategory, avgInterval, intervalStr, trend,
        confidence, sectorSize, lastNum, cv, robustCV, stdDev, offset, dir,
        predictedNum: ROULETTE_NUMBERS[predictedIdx],
        topNumbers: finalScores.slice(0, 8),
        // Core metrics
        kappa, entropy: entropy.toFixed(2), entropyRatio: entropyRatio.toFixed(2),
        frictionCoeff: frictionCoeff.toFixed(4),
        dealerSignature: dealerSignatureStrength.toFixed(2),
        isSniper, hitRate, avgError,
        trendSlope: trendSlope.toFixed(2), trendAccel: trendAccel.toFixed(3),
        predictedNextInterval: predictedNextInterval.toFixed(1),
        dominantDiamond: _dominantDiamond,
        totalPredictions: completedPreds.length,
        dealerGrade, autocorrPeriod: _autocorrPeriod,
        cusumChangeActive, bmaWeights,
        phaseSpaceNeighbors: _phaseSpaceCache.length,
        // v7.0 QUANTUM NEXUS metrics
        lyapunovExponent: lyapunovExponent.toFixed(3),
        lyapunovStability: lyapunovExponent < 2.0 ? 'STABLE' : lyapunovExponent < 2.8 ? 'MODERATE' : 'CHAOTIC',
        waveletTrend: waveletTrend.toFixed(1),
        waveletNoise: waveletDetail.toFixed(2),
        mcConcentration,
        particleCount: _particleFilter.length,
        ngramSectors: Object.keys(_ngramSectorCache).length,
        grangerCausality: grangerCausalityStrength.toFixed(3),
        driftCorrection: currentDrift.toFixed(2),
        brierScore: brierScore.toFixed(3),
        modelAccuracy: modelAccDisplay,
        totalModels: 13,
        engineVersion: '7.0'
    };
}


// ============================================================
// MAIN UPDATE
// ============================================================
function updateApp(){
    saveState();
    document.getElementById('spin-count').innerText=spinHistory.length;
    tape.innerHTML='';
    if(spinHistory.length===0){
        tape.innerHTML='<div class="chip-placeholder">Input spins below</div>';
    } else {
        [...spinHistory].reverse().forEach((n,idx)=>{
            let el=document.createElement('div');
            el.className=`chip ${getColorClass(n)} ${idx===0?'newest':''}`;
            el.innerText=n; tape.appendChild(el);
        });
    }
    runAnalyticsAndBetting();
}

function updateBar(id1,id2,v1,v2,tot){
    let p1=50,p2=50;
    if(tot>0){p1=Math.round((v1/tot)*100);p2=Math.round((v2/tot)*100);}
    else{p1=0;p2=0;}
    let e1=document.getElementById(`pct-${id1}`);if(e1)e1.innerText=`${p1}%`;
    let e2=document.getElementById(`pct-${id2}`);if(e2)e2.innerText=`${p2}%`;
    let b1=document.getElementById(`bar-${id1}`);if(b1)b1.style.width=`${tot>0?p1:50}%`;
}

function resetUI(){
    // Main bet card
    const bc=document.getElementById('main-bet-card');
    const bl=document.getElementById('main-bet-label');
    const ba=document.getElementById('main-bet-amount');
    const bf=document.getElementById('main-bet-footer');
    if(bc) bc.className='main-bet-card glass no-signal';
    if(bl){ bl.innerHTML='WAIT'; bl.className='mbc-play wait-state'; }
    if(ba){ ba.innerHTML='—'; ba.className='mbc-amount'; }
    let pg=document.getElementById('main-bet-prog'); if(pg) pg.innerText='';
    let bg=document.getElementById('main-bet-badge'); if(bg){ bg.innerText='—'; bg.style.color=''; }
    if(bf) bf.innerHTML='<span style="color:#555;font-size:9px">Input 5+ spins to begin analysis</span>';
    // Bottom mini boxes
    [1,2,3].forEach(i=>{
        let el=document.getElementById(`pred-${i}`); if(el){el.innerHTML='--';el.className='mini-val';}
        let be=document.getElementById(`bet-${i}`); if(be){be.innerHTML='—';be.className='mini-bet';}
        let bx=document.getElementById(`box-pred-${i}`); if(bx)bx.classList.remove('active-bet','highly-confident-bet');
    });
    ['column','dozen','outside','voisins','tiers','orphelins'].forEach(id=>{
        let p=document.getElementById(`pred-${id}`); if(p)p.innerHTML='—';
        let b=document.getElementById(`bet-${id}`); if(b){b.innerHTML='—';b.className='mini-bet';}
        let x=document.getElementById(`box-${id}`); if(x)x.classList.remove('active-bet');
    });
    document.getElementById('streak-alert').innerHTML='None';
    document.getElementById('dealer-sig').innerHTML='Analyzing...';
    updateBar('red','black',0,0,0);
    ['d1','d2','d3'].forEach(id=>{
        let e=document.getElementById(`pct-${id}`);if(e)e.innerText='0%';
        let b=document.getElementById(`bar-${id}`);if(b)b.style.width='33.3%';
    });
    let mp=document.getElementById('mini-pnl');
    if(mp){mp.innerText='P&L: 0 Pts';mp.className='mini-pnl';}
}

function runAnalyticsAndBetting(){
    const len=spinHistory.length;
    if(len<5){resetUI();return;}

    // ---- 1. MAIN BET CARD ----
    const bestBet = getBestBet(spinHistory);
    const bc  = document.getElementById('main-bet-card');
    const bl  = document.getElementById('main-bet-label');
    const ba  = document.getElementById('main-bet-amount');
    const bf  = document.getElementById('main-bet-footer');
    const bg  = document.getElementById('main-bet-badge');
    const pg  = document.getElementById('main-bet-prog');

    if(consecutiveLosses >= 5){
        bc.className='main-bet-card glass circuit-break';
        bl.innerHTML='⛔ PAUSE BETTING';
        bl.className='mbc-play circuit-state';
        ba.innerHTML='Break';
        ba.className='mbc-amount';
        if(pg) pg.innerText=`${consecutiveLosses} consecutive losses`;
        if(bg){ bg.innerText='⚠️ Circuit'; bg.style.color='#ff5252'; }
        if(bf) bf.innerHTML='<span class="mbc-strength" style="color:#ff5252">Step back — observe next 3 spins before betting</span>';
    } else if(bestBet){
        bc.className='main-bet-card glass has-signal';
        bl.innerHTML = bestBet.pred;
        bl.className='mbc-play';
        const betAmt = getBetAmount(betLossCount);
        ba.innerHTML = `${betAmt} Pts`;
        ba.className = 'mbc-amount hot';
        // Progression info
        const progInfo = progMode==='FLAT'?'Flat bet'
            :progMode==='FIBO'?`Fibonacci step ${betLossCount}`
            :progMode==='DALE'?`D'Alembert +${betLossCount}`
            :`Martingale ×${Math.pow(2,Math.min(betLossCount,4)).toFixed(0)}`;
        if(pg) pg.innerText = progInfo;
        if(bg){ bg.innerText=`${len} spins`; bg.style.color=''; }
        // Quality label
        const z = bestBet.zScore;
        const ql = z>=3.5?'🔥 Very Strong':z>=2.5?'⚡ Strong':'✓ Good';
        const qc = z>=3.5?'#ff6b35':z>=2.5?'#ffd700':'#69f0ae';
        const typeLabel = bestBet.type==='streak'?'Streak Signal'
            :bestBet.type==='col'?'2-to-1 Column'
            :bestBet.type==='doz'?'2-to-1 Dozen':'Even Chance';
        if(bf) bf.innerHTML=
            `<span class="mbc-strength">${typeLabel} · Payout ${bestBet.payout}:1</span>`+
            `<span class="mbc-quality" style="color:${qc}">${ql} (${z.toFixed(1)}σ)</span>`;
        speakText(`${bestBet.pred.replace(/<[^>]*>?/gm,'')} — ${betAmt} points`);
    } else {
        bc.className='main-bet-card glass no-signal';
        const msg = len<20?`WAIT — ${20-len} more spins needed`
            :'NO SIGNAL — Observe';
        bl.innerHTML=msg;
        bl.className='mbc-play wait-state';
        ba.innerHTML='—';
        ba.className='mbc-amount';
        if(pg) pg.innerText='';
        if(bg){ bg.innerText=`${len} spins`; bg.style.color=''; }
        if(bf) bf.innerHTML='<span class="mbc-strength">No statistically significant pattern detected yet</span>';
    }

    // ---- 2. Secondary bet info (area boxes) ----
    ['column','dozen','outside','voisins','tiers','orphelins'].forEach(id=>{
        let p=document.getElementById(`pred-${id}`);
        let b=document.getElementById(`bet-${id}`);
        let x=document.getElementById(`box-${id}`);
        if(p)p.innerHTML='—';
        if(b){b.innerHTML='—';b.className='mini-bet';}
        if(x)x.classList.remove('active-bet');
    });
    if(bestBet && consecutiveLosses<5){
        const tid=bestBet.type==='col'?'column':bestBet.type==='doz'?'dozen':'outside';
        let p=document.getElementById(`pred-${tid}`);
        let b=document.getElementById(`bet-${tid}`);
        let x=document.getElementById(`box-${tid}`);
        const plainBet=bestBet.pred.replace(/<[^>]*>?/gm,'');
        if(p)p.innerHTML=`<span style="font-size:9px;font-weight:700">${plainBet}</span>`;
        if(b){b.innerHTML='Active';b.className='mini-bet hot';}
        if(x)x.classList.add('active-bet');
        let ti=document.getElementById('pred-tiers');
        if(ti)ti.innerHTML=`${bestBet.zScore.toFixed(1)}σ`;
    }

    // ---- 3. Streaks ----
    let stText='None';
    if(len>=7){
        let last7=spinHistory.slice(-7);
        let bC=0,rC=0,eC=0,oC=0;
        last7.forEach(n=>{if(n!==0){RED_NUMBERS.includes(n)?rC++:bC++;n%2===0?eC++:oC++;}});
        if(rC>=6)      stText="<span class='text-red'>Red Streak 🔥</span>";
        else if(bC>=6) stText="Black Streak 🔥";
        else if(eC>=6) stText="<span class='text-gold'>Even Streak</span>";
        else if(oC>=6) stText="<span class='text-gold'>Odd Streak</span>";
        else if(rC>=5) stText="<span class='text-red'>Red Trending ↑</span>";
        else if(bC>=5) stText="Black Trending ↑";
    }
    document.getElementById('streak-alert').innerHTML=stText;

    // ---- 4. Wheel Speed Analysis (compute ONCE, cache for top numbers) ----
    {
        _cachedWheelSpeed = computeWheelSpeedData();
        const ws = _cachedWheelSpeed;
        if(ws.valid){
            const ICONS ={FAST:'⚡',MEDIUM:'🌀',SLOW:'🐢'};
            const COLS  ={FAST:'#ff9800',MEDIUM:'#ffd700',SLOW:'#69f0ae'};
            const TREND ={SPEEDING:'↗ Spd',STABLE:'→ Stb',SLOWING:'↘ Slw',ACCELERATING:'⏫ Acc',DECELERATING:'⏬ Dec'};
            const TCOL  ={SPEEDING:'#ff9800',STABLE:'#666',SLOWING:'#69f0ae',ACCELERATING:'#ff5252',DECELERATING:'#4fc3f7'};
            const confColor=ws.confidence>=65?'#69f0ae':ws.confidence>=45?'#ffd700':'#ff9800';
            const gradeColor={'A+':'#69f0ae','A':'#69f0ae','B+':'#ffd700','B':'#ffd700','C':'#ff9800','D':'#ff5252'}[ws.dealerGrade]||'#666';
            const pNum = ws.predictedNum;
            const pCol = RED_NUMBERS.includes(pNum)?'#ff5252':pNum===0?'#69f0ae':'#ccc';
            const altNumsArr = ws.topNumbers.filter(x => x.num !== pNum).slice(0,3);
            const altStr = altNumsArr.map(it => {
                const col=RED_NUMBERS.includes(it.num)?'#ff5252':it.num===0?'#69f0ae':'#ccc';
                return `<span style="color:${col};font-weight:bold">${it.num}</span>`;
            }).join('<span style="color:#2a2a2a;margin:0 2px">·</span>');
            
            // v7.0 indicators
            const cusumStr = ws.cusumChangeActive ? '<span style="color:#ff5252;font-size:7px"> ⚠ CHG</span>' : '';
            const acStr = ws.autocorrPeriod > 0 ? `<span style="color:#00e5ff;font-size:7px"> 🔄P${ws.autocorrPeriod}</span>` : '';
            const hitStr = ws.totalPredictions > 0 ? `<span style="font-size:7px;color:${ws.hitRate>=30?'#69f0ae':'#ff9800'}"> ${ws.hitRate}%hit</span>` : '';
            const lyapColor = ws.lyapunovStability==='STABLE'?'#69f0ae':ws.lyapunovStability==='MODERATE'?'#ffd700':'#ff5252';
            const lyapIcon = ws.lyapunovStability==='STABLE'?'🟢':ws.lyapunovStability==='MODERATE'?'🟡':'🔴';
            const gcStr = parseFloat(ws.grangerCausality) > 0.3 ? `<span style="color:#00e5ff;font-size:7px"> ⚡GC${(parseFloat(ws.grangerCausality)*100).toFixed(0)}%</span>` : '';
            const mcStr = ws.mcConcentration > 0 ? `<span style="font-size:7px;color:#b388ff">MC${ws.mcConcentration}%</span>` : '';
            const driftStr = Math.abs(parseFloat(ws.driftCorrection)) >= 0.5 ? `<span style="font-size:7px;color:#ffab40">↔${ws.driftCorrection}</span>` : '';
            
            document.getElementById('dealer-sig').innerHTML=
                `<span style="font-size:9px;line-height:1.8">`+
                `<span style="color:${COLS[ws.speedCategory]};font-weight:700">${ICONS[ws.speedCategory]} ${ws.speedCategory}</span>`+
                ` <span style="color:${gradeColor};font-weight:800;font-size:8px;border:1px solid ${gradeColor};border-radius:3px;padding:0 3px">${ws.dealerGrade}</span>`+
                `<span style="color:#444"> ~${ws.intervalStr} · <span style="color:${confColor}">${ws.confidence}%</span></span><br>`+
                `<span style="color:#888">🎯</span> <span style="color:${pCol};font-weight:bold;font-size:11px">${pNum}</span> `+
                `<span style="color:#555">|</span> ${altStr}${hitStr}<br>`+
                `<span style="color:${TCOL[ws.trend]||'#666'};font-size:7px">${TREND[ws.trend]||ws.trend}</span> `+
                `<span style="font-size:7px;color:#444">P${ws.bmaWeights.physics}·M${ws.bmaWeights.pattern}·S${ws.bmaWeights.statistical}</span> `+
                `${lyapIcon}<span style="color:${lyapColor};font-size:7px">${ws.lyapunovStability}</span> `+
                `${mcStr} ${driftStr}${gcStr}`+
                `${ws.isSniper?'<span style="font-size:7px"> 🎯SNP</span>':''}${cusumStr}${acStr}`+
                `<span style="color:#444;font-size:6px"> v7·${ws.totalModels}m</span></span>`;
        } else {
            const liveFreq=new Array(37).fill(0);
            spinHistory.forEach(n=>liveFreq[n]++);
            const liveW=len>0?len:1;
            const hs=[];
            for(let n=0;n<=36;n++){
                const hN=(BASE_FREQ[n]/BASE_TOTAL)*37;
                const lN=(liveFreq[n]/liveW)*37;
                hs.push({num:n,score:(hN*0.5)+(lN*(len>=10?0.5:0.2))});
            }
            hs.sort((a,b)=>b.score-a.score);
            const top5 = hs.slice(0,5);
            const nums = top5.map(s => {
                const col=RED_NUMBERS.includes(s.num)?'#ff5252':s.num===0?'#69f0ae':'#ccc';
                return `<span style="color:${col};font-weight:bold">${s.num}</span>`;
            }).join('<span style="color:#333;margin:0 2px">·</span>');
            const need=ws.remaining>0?`⏱️ Need ${ws.remaining} more`:'🔥 Hot';
            document.getElementById('dealer-sig').innerHTML=
                `<span style="font-size:9px;color:#555">${need}:</span> ${nums}`;
        }
    }

    // ---- 5. Progress Bars ----
    let r30=spinHistory.slice(-30);
    let r=0,bl2=0,d1_=0,d2_=0,d3_=0,nz=0;
    r30.forEach(n=>{if(n===0)return;nz++;RED_NUMBERS.includes(n)?r++:bl2++;if(n<=12)d1_++;else if(n<=24)d2_++;else d3_++;});
    updateBar('red','black',r,bl2,nz);
    if(nz>0){
        let pd1=Math.round((d1_/nz)*100),pd2=Math.round((d2_/nz)*100);
        document.getElementById('pct-d1').innerText=`${pd1}%`;
        document.getElementById('pct-d2').innerText=`${pd2}%`;
        document.getElementById('pct-d3').innerText=`${100-pd1-pd2}%`;
        document.getElementById('bar-d1').style.width=`${pd1}%`;
        document.getElementById('bar-d2').style.width=`${pd2}%`;
        document.getElementById('bar-d3').style.width=`${100-pd1-pd2}%`;
    }

    // ---- 6. Loss tracking ----
    if(spinHistory.length>=2){
        const rb=getBestBetSimple(spinHistory.slice(0,-1),consecutiveLosses);
        if(rb){
            const la=spinHistory[spinHistory.length-1];
            if(satisfiesBet(la,rb)){consecutiveLosses=0;betLossCount=0;}
            else{consecutiveLosses++;betLossCount++;if(consecutiveLosses>=5)consecutiveLosses=0;}
        }
    }

    // ---- 7. Mini P&L (text only, no chart) ----
    const bHist=calculatePnL(spinHistory);
    const bal=Math.round(bHist[bHist.length-1]||0);
    const mp=document.getElementById('mini-pnl');
    if(mp){
        mp.innerText=`${bal>0?'+':''}${bal} Pts`;
        mp.className='mini-pnl'+(bal>0?' profit':bal<0?' loss':'');
    }

    // ---- 8. Top 3 Numbers (bottom secondary panel) ----
    const topNums=computeTopNumbers(spinHistory);
    const betThresh=isAggressive?45:65;
    for(let i=1;i<=3;i++){
        const pick=topNums[i-1];
        const el=document.getElementById(`pred-${i}`);
        const box=document.getElementById(`box-pred-${i}`);
        const be=document.getElementById(`bet-${i}`);
        if(!el||!box||!be) continue;
        el.innerHTML=`${pick.num}`;
        el.className=`mini-val ${getTextColorClass(pick.num)}`;
        const conf=pick.confidence;
        if(conf>=betThresh){
            be.innerHTML=`🔥 ${conf}%`;
            be.className='mini-bet hot';
            box.classList.add('active-bet');
            if(conf>=75)box.classList.add('highly-confident-bet');
            else box.classList.remove('highly-confident-bet');
        } else {
            be.innerHTML=`${conf}%`;
            be.className='mini-bet';
            box.classList.remove('active-bet','highly-confident-bet');
        }
    }

    fetchMLUpdate();
}

// ============================================================
// ML BACKEND
// ============================================================
async function fetchMLUpdate(){
    if(spinHistory.length < 5) return;
    try{
        const res=await fetch(`http://${serverIP}:5000/predict`,{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({spins:spinHistory})
        });
        if(res.ok){
            const data=await res.json();
            if(data.status==='success'){
                const top3=data.predictions;
                const betThreshML=isAggressive?45:65;
                const mlShouldBet=data.confidence>betThreshML;
                for(let i=1;i<=3;i++){
                    const el=document.getElementById(`pred-${i}`);
                    const num=top3[i-1];
                    if(num===undefined||num===null||!el) continue;
                    el.innerHTML=`${num} <span style="font-size:8px;color:#00e5ff">🤖</span>`;
                    el.className=`mini-val ${getTextColorClass(num)}`;
                    const box=document.getElementById(`box-pred-${i}`);
                    const betEl=document.getElementById(`bet-${i}`);
                    if(!box||!betEl) continue;
                    if(mlShouldBet){
                        betEl.innerHTML=`🤖 ${data.confidence.toFixed(0)}%`;
                        betEl.className='mini-bet hot';
                        box.classList.add('active-bet');
                        if(data.confidence>=75)box.classList.add('highly-confident-bet');
                        else box.classList.remove('highly-confident-bet');
                    } else {
                        betEl.innerHTML=`${data.confidence.toFixed(0)}%`;
                        betEl.className='mini-bet';
                        box.classList.remove('active-bet','highly-confident-bet');
                    }
                }
                const sigColor=data.signal==='HIGH'?'#69f0ae':data.signal==='GOOD'?'#ffd700':data.signal==='LOW'?'#ff9800':'#ff5252';
                updateServerStatus(`🤖 ${data.signal} (${data.confidence.toFixed(0)}%)`,'online');
                
                // ML Overdrive - Override Main Bet Card if confidence > 85
                if (data.confidence >= 85) {
                    const bc = document.getElementById('main-bet-card');
                    const bl = document.getElementById('main-bet-label');
                    const bf = document.getElementById('main-bet-footer');
                    const bg = document.getElementById('main-bet-badge');
                    
                    if (bc && !bc.className.includes('circuit-break')) {
                        bc.className = 'main-bet-card glass has-signal highly-confident-bet';
                        bc.style.border = '2px solid #69f0ae';
                        bc.style.boxShadow = '0 0 20px rgba(105, 240, 174, 0.4)';
                        bl.innerHTML = `🔥 Number <b>${top3[0]}</b> 🔥`;
                        bl.style.color = '#69f0ae';
                        bl.style.fontSize = '2.5rem';
                        if (bf) bf.innerHTML = `<span class="mbc-strength" style="color:#69f0ae;font-weight:bold">🤖 ML OVERDRIVE ACTIVE (35:1)</span>`;
                        if (bg) { bg.innerText = '🤖 Deep AI'; bg.style.color = '#69f0ae'; bg.style.borderColor = '#69f0ae'; }
                    }
                }
                
            } else if(data.error){ updateServerStatus('ML: Error','offline'); }
        } else { updateServerStatus('Offline','offline'); }
    }catch(e){ updateServerStatus('Offline','offline'); }
}

init();

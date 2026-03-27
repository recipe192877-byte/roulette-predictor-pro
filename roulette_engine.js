// ============================================================
// ROULETTE PREDICTOR PRO - v3.1 SMART ENGINE
// Key Fix: ONE best bet per spin, not 6 simultaneous bets
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
let progMode = 'FLAT'; // Default to FLAT for safety
let serverIP = localStorage.getItem('rppro_server_ip') || 'localhost';
const BASE_UNIT = 10;
const MAX_BET = 200;
const FIB = [1,1,2,3,5,8,13,21,34,55,89];
let isVoiceEnabled = false;
let pnlChartInstance = null;
let consecutiveLosses = 0; // Track losses for circuit breaker

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
        if(confirm("Clear all history?")) { spinHistory=[]; consecutiveLosses=0; updateApp(); }
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

    const scores=[];
    for(let n=0;n<=36;n++){
        // L1: Historical baseline
        const histScore=(BASE_FREQ[n]/BASE_TOTAL)*37;
        const L1=histScore*2.5;

        // L2: Live recency EMA
        let liveRecency=0;
        for(let j=0;j<N;j++){
            if(liveHistory[j]===n){
                const age=N-1-j;
                let w=age<10?1.5:age<25?1.0:0.4;
                liveRecency+=w;
            }
        }
        const L2=liveRecency*1.8;

        // L3: Markov Chain
        let markov=0;
        if(lastNum>=0){
            const row1=combinedTransRow(lastNum);
            const r1Total=row1.reduce((a,b)=>a+b,0)||1;
            markov+=(row1[n]/r1Total)*37*3.0;
        }
        if(last2Num>=0&&lastNum>=0){
            const diag=liveTransitions[last2Num][lastNum]>0
                ?(liveTransitions[lastNum][n]/(liveTransitions[last2Num][lastNum]+0.5)):0;
            markov+=diag*1.5;
        }
        const L3=markov;

        // L4: Gap/Due
        let gapScore=0;
        const gap=lastSeen[n]>=0?(N-1-lastSeen[n]):N+37;
        if(gap>37*1.8) gapScore=Math.min((gap/37)*0.8,3.5);
        else if(gap<8)  gapScore=(8-gap)*0.25;
        const L4=gapScore*1.2;

        // L5: Wheel sector
        let sector=0;
        const wheelIdx=ROULETTE_NUMBERS.indexOf(n);
        const recent15=liveHistory.slice(-15);
        for(const rn of recent15){
            const rnIdx=ROULETTE_NUMBERS.indexOf(rn);
            if(rnIdx<0)continue;
            let dist=Math.abs(rnIdx-wheelIdx);
            if(dist>18)dist=37-dist;
            if(dist<=3&&dist>0) sector+=(4-dist)*0.35;
        }
        const L5=sector*1.5;

        scores.push({num:n,score:L1+L2+L3+L4+L5});
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
    const THRESH = isAggressive ? 1.5 : 2.0; // Require 2 SD deviation
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
    const THRESH_H = isAggressive ? 1.3 : 1.8;
    const outCands=[
        {label:'RED',  pred:"<span class='text-red'>Play RED</span>",  hits:r,payout:2},
        {label:'BLK',  pred:"Play BLACK",                               hits:b,payout:2},
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
        {hits:b5,pred:"Play BLACK",label:'BLK',payout:2},
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
    } catch(e){}
}
function saveState(){
    try{
        localStorage.setItem('rppro_history',JSON.stringify(spinHistory));
        localStorage.setItem('rppro_risk',isAggressive);
        localStorage.setItem('rppro_prog_mode',progMode);
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

function addSpin(n){if(spinHistory.length>=MAX_HISTORY)spinHistory.shift();spinHistory.push(n);updateApp();}
function undoSpin(){if(spinHistory.length>0)spinHistory.pop();updateApp();}

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
    // Bug fix: was 20, now 8 — chart starts populating earlier
    if(spins.length < 8) return [0];
    let balance=0, bHist=[0];
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
// CHART
// ============================================================
function renderChart(dataArr){
    let ctx=document.getElementById('pnlChart');
    if(!ctx)return;
    let labels=dataArr.map((_,i)=>i);
    let color=dataArr[dataArr.length-1]>=0?'#69f0ae':'#ff5252';
    if(pnlChartInstance){
        pnlChartInstance.data.labels=labels;
        pnlChartInstance.data.datasets[0].data=dataArr;
        pnlChartInstance.data.datasets[0].borderColor=color;
        pnlChartInstance.data.datasets[0].backgroundColor=color==='#69f0ae'?'rgba(105,240,174,0.08)':'rgba(255,82,82,0.08)';
        pnlChartInstance.update();
    } else {
        Chart.defaults.color='#888';Chart.defaults.font.family='Montserrat';
        pnlChartInstance=new Chart(ctx,{
            type:'line',
            data:{labels,datasets:[{label:'Virtual PnL',data:dataArr,borderColor:color,borderWidth:2,pointRadius:0,tension:0.3,fill:true,backgroundColor:'rgba(105,240,174,0.08)'}]},
            options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:true,grid:{color:'rgba(255,255,255,0.05)'}}}}
        });
    }
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
    [1,2,3].forEach(i=>{
        document.getElementById(`pred-${i}`).innerHTML='--';
        document.getElementById(`pred-${i}`).className='val';
        document.getElementById(`bet-${i}`).innerHTML='Wait';
        document.getElementById(`bet-${i}`).className='bet-amt';
        document.getElementById(`box-pred-${i}`).classList.remove('active-bet','highly-confident-bet');
    });
    ['column','dozen','outside','voisins','tiers','orphelins'].forEach(id=>{
        let pEl=document.getElementById(`pred-${id}`); if(pEl)pEl.innerHTML='Need 20+';
        let bEl=document.getElementById(`bet-${id}`); if(bEl){bEl.innerHTML='--';bEl.className='bet-amt mt-5';}
        let bxEl=document.getElementById(`box-${id}`); if(bxEl)bxEl.classList.remove('active-bet');
    });
    document.getElementById('streak-alert').innerHTML='None';
    document.getElementById('dealer-sig').innerHTML='Analyzing...';
    updateBar('red','black',0,0,0);
    ['d1','d2','d3'].forEach(id=>{
        let e=document.getElementById(`pct-${id}`);if(e)e.innerText='0%';
        let b=document.getElementById(`bar-${id}`);if(b)b.style.width='33.3%';
    });
    renderChart([0]);
    let bal=document.getElementById('balance-display');
    bal.innerText='0 Pts';bal.style.color='#888';
}

function runAnalyticsAndBetting(){
    const len=spinHistory.length;
    if(len<5){resetUI();return;}

    // ---- 1. Top 3 Numbers (5-Layer Engine) ----
    const topNums=computeTopNumbers(spinHistory);
    for(let i=1;i<=3;i++){
        const pick=topNums[i-1];
        const el=document.getElementById(`pred-${i}`);
        const box=document.getElementById(`box-pred-${i}`);
        const betEl=document.getElementById(`bet-${i}`);
        let conf=pick.confidence;
        let confLabel=conf>=65?` <span style="font-size:10px;color:#ff6b35;">🔥${conf}%</span>`
                     :conf>=45?` <span style="font-size:10px;color:#ffd700;">⚡${conf}%</span>`
                     :` <span style="font-size:10px;color:#888;">❄️${conf}%</span>`;
        el.innerHTML=`${pick.num}${confLabel}`;
        el.className=`val ${getTextColorClass(pick.num)}`;
        const betThresh=isAggressive?45:65;
        if(conf>=betThresh){
            betEl.innerHTML=`Bet ${BASE_UNIT} Pts`;
            betEl.className='bet-amt hot';
            box.classList.add('active-bet');
            if(conf>=75)box.classList.add('highly-confident-bet');
            else box.classList.remove('highly-confident-bet');
        } else {
            betEl.innerHTML='Wait';betEl.className='bet-amt';
            box.classList.remove('active-bet','highly-confident-bet');
        }
    }

    // ---- 2. SMART SINGLE BEST BET for outside categories ----
    // First clear all area boxes
    ['column','dozen','outside','voisins','tiers','orphelins'].forEach(id=>{
        let pEl=document.getElementById(`pred-${id}`);
        let betEl=document.getElementById(`bet-${id}`);
        let box=document.getElementById(`box-${id}`);
        if(pEl)pEl.innerHTML=len<20?'Need 20+':'—';
        if(betEl){betEl.innerHTML='Skip';betEl.className='bet-amt mt-5';}
        if(box)box.classList.remove('active-bet');
    });

    const bestBet=getBestBet(spinHistory);
    let circuitLabel=consecutiveLosses>=5?`<span style='color:#ff5252;font-size:10px'>⚠️ Circuit Break (${consecutiveLosses} losses)</span>`:'';

    if(bestBet){
        // Show best bet in the appropriate box
        let targetId;
        if(bestBet.type==='col')    targetId='column';
        else if(bestBet.type==='doz') targetId='dozen';
        else                          targetId='outside'; // out or streak

        let pEl=document.getElementById(`pred-${targetId}`);
        let betEl=document.getElementById(`bet-${targetId}`);
        let box=document.getElementById(`box-${targetId}`);

        if(pEl) pEl.innerHTML=bestBet.pred;
        if(betEl){
            const betAmt=getBetAmount(0); // flat
            betEl.innerHTML=`Bet ${betAmt} Pts ${circuitLabel}`;
            betEl.className='bet-amt hot mt-5';
        }
        if(box) box.classList.add('active-bet');

        // Show z-score in tiers box as info
        let tiersEl=document.getElementById('pred-tiers');
        if(tiersEl) tiersEl.innerHTML=`<span style='font-size:10px;color:#aaa'>Strength: ${bestBet.zScore.toFixed(2)}σ</span>`;

        // Show "no other bets" in others to clarify
        let vEl=document.getElementById('pred-voisins');
        if(vEl) vEl.innerHTML=`<span style='font-size:10px;color:#555'>Focused mode</span>`;

        speakText(`${bestBet.pred.replace(/<[^>]*>?/gm,'')} — ${getBetAmount(0)} points`);
    } else {
        // No signal → show circuit breaker or waiting message
        let msg=len<20?'Need 20+ spins':consecutiveLosses>=5?'Circuit Break — Pause':'No Signal — Wait';
        let colEl=document.getElementById('pred-column');
        if(colEl) colEl.innerHTML=`<span style='font-size:11px;color:#aaa'>${msg}</span>`;
        let vEl=document.getElementById('pred-voisins');
        if(vEl) vEl.innerHTML=circuitLabel||'<span style="font-size:10px;color:#555">—</span>';
    }

    // ---- 3. Streaks ----
    let stText='None';
    if(len>=7){
        let last7=spinHistory.slice(-7);
        let bC=0,rC=0,eC=0,oC=0;
        last7.forEach(n=>{if(n!==0){RED_NUMBERS.includes(n)?rC++:bC++;n%2===0?eC++:oC++;}});
        if(rC>=6) stText="<span class='text-red'>Red Streak 🔥</span>";
        else if(bC>=6) stText="Black Streak 🔥";
        else if(eC>=6) stText="<span class='text-gold'>Even Streak</span>";
        else if(oC>=6) stText="<span class='text-gold'>Odd Streak</span>";
        else if(rC>=5) stText="<span class='text-red'>Red Trending ↑</span>";
        else if(bC>=5) stText="Black Trending ↑";
    }
    document.getElementById('streak-alert').innerHTML=stText;

    // ---- 4. Wheel Bias — Always shows TOP 5 HOT NUMBERS ----
    // Combines historical baseline + live session frequency
    // This ALWAYS shows something useful, never 'Unclear' or blank.
    {
        const liveFreq = new Array(37).fill(0);
        spinHistory.forEach(n => liveFreq[n]++);
        const liveW = len > 0 ? len : 1;

        // Combined score: 50% historical baseline + 50% live frequency (normalized)
        const hotScores = [];
        for(let n = 0; n <= 36; n++){
            const histNorm = (BASE_FREQ[n] / BASE_TOTAL) * 37;       // avg = 1.0
            const liveNorm = (liveFreq[n] / liveW) * 37;             // avg = 1.0
            const combined = (histNorm * 0.5) + (liveNorm * (len >= 10 ? 0.5 : 0.2));
            hotScores.push({ num: n, score: combined });
        }
        hotScores.sort((a, b) => b.score - a.score);

        // Top 5 hot numbers (exclude 0 unless genuinely very hot)
        const top5 = hotScores.filter(s => s.num !== 0 || s.score > 1.5).slice(0, 5);
        const top5Nums = top5.map(s => {
            const col = RED_NUMBERS.includes(s.num) ? '#ff5252' : s.num === 0 ? '#69f0ae' : '#ccc';
            return `<span style="color:${col};font-weight:bold">${s.num}</span>`;
        }).join(' · ');

        const label = len >= 10 ? 'Hot Numbers 🔥' : 'Base Bias';
        document.getElementById('dealer-sig').innerHTML =
            `<span style="font-size:11px;line-height:1.6">`+
            `<span style="color:#aaa;font-size:10px">${label}:</span><br>${top5Nums}</span>`;
    }


    // ---- 5. Progress Bars ----
    let r30=spinHistory.slice(-30);
    let r=0,bl=0,d1_=0,d2_=0,d3_=0,nz=0;
    r30.forEach(n=>{if(n===0)return;nz++;RED_NUMBERS.includes(n)?r++:bl++;if(n<=12)d1_++;else if(n<=24)d2_++;else d3_++;});
    updateBar('red','black',r,bl,nz);
    if(nz>0){
        let pd1=Math.round((d1_/nz)*100),pd2=Math.round((d2_/nz)*100);
        document.getElementById('pct-d1').innerText=`${pd1}%`;
        document.getElementById('pct-d2').innerText=`${pd2}%`;
        document.getElementById('pct-d3').innerText=`${100-pd1-pd2}%`;
        document.getElementById('bar-d1').style.width=`${pd1}%`;
        document.getElementById('bar-d2').style.width=`${pd2}%`;
        document.getElementById('bar-d3').style.width=`${100-pd1-pd2}%`;
    }

    // ---- 6. PnL Chart ----
    let bHist=calculatePnL(spinHistory);
    let bal=bHist[bHist.length-1]||0;
    // Update consecutive losses tracking for display
    if(spinHistory.length>=2){
        // Detect last bet result
        const recentBet=getBestBetSimple(spinHistory.slice(0,-1),consecutiveLosses);
        if(recentBet){
            const lastActual=spinHistory[spinHistory.length-1];
            if(satisfiesBet(lastActual,recentBet)){consecutiveLosses=0;}
            else{consecutiveLosses++;}
        }
    }
    let balEl=document.getElementById('balance-display');
    balEl.innerText=`${bal>0?'+':''}${bal} Pts`;
    balEl.style.color=bal>=0?'#69f0ae':'#ff5252';
    renderChart(bHist);

    fetchMLUpdate();
}

// ============================================================
// ML BACKEND
// ============================================================
async function fetchMLUpdate(){
    try{
        let res=await fetch(`http://${serverIP}:5000/predict`,{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({spins:spinHistory})
        });
        if(res.ok){
            updateServerStatus('Online','online');
            let data=await res.json();
            if(data.status==='success'){
                let top3=data.predictions;
                for(let i=1;i<=3;i++){
                    let el=document.getElementById(`pred-${i}`);
                    let num=top3[i-1];
                    el.innerHTML=`${num} <span style="font-size:10px;color:#00e5ff">🤖ML</span>`;
                    el.className=`val ${getTextColorClass(num)}`;
                    let box=document.getElementById(`box-pred-${i}`);
                    let betEl=document.getElementById(`bet-${i}`);
                    if(data.confidence>2.5){betEl.innerHTML=`Bet ${BASE_UNIT} Pts`;betEl.className='bet-amt hot';box.classList.add('active-bet');}
                    else{betEl.innerHTML='Wait';betEl.className='bet-amt';box.classList.remove('active-bet','highly-confident-bet');}
                }
                // Bug fix: do NOT overwrite dealer-sig — that's the Wheel Bias track numbers.
                // Show ML engine name in server status bar instead.
                updateServerStatus(`ML: ${data.model.substring(0,18)}`, 'online');
            }
        } else{updateServerStatus('Offline','offline');}
    }catch(e){updateServerStatus('Offline','offline');}
}

init();

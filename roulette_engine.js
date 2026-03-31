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
// ADVANCED WHEEL SPEED ANALYSIS ENGINE
// ============================================================
// Algorithm combines:
//  1. Recency-weighted interval average (recent spins count more)
//  2. Coefficient of variation (CV) for consistency scoring
//  3. Speed trend detection (SPEEDING / STABLE / SLOWING)
//  4. Gaussian probability spread from last wheel position
//  5. Multi-factor blend: speed sector + recency freq + Markov
//  6. Dynamic confidence score adjusted by variance and data size
// ============================================================
function computeWheelSpeedData() {
    const len = spinHistory.length;
    if(spinTimestamps.length < 3 || len < 2)
        return { valid:false, remaining: Math.max(0, 3 - spinTimestamps.length) };

    // --- Step 1: Build valid intervals (filter rapid manual entry < 8s) ---
    const allIntervals = [];
    for(let i = 1; i < spinTimestamps.length; i++) {
        const s = (spinTimestamps[i] - spinTimestamps[i-1]) / 1000;
        if(s >= 8 && s < 300) allIntervals.push(s);
    }
    
    // Default values if user is entering data manually and no real timing exists
    let avgInterval = 40; 
    let cv = 0.2; 
    let trend = 'STABLE';
    let stdDev = 0;

    if(allIntervals.length >= 2) {
        // --- Step 2: Recency-weighted average ---
        const recent     = allIntervals.slice(-7);
        const wts        = recent.map((_, i) => i + 1);
        const wSum       = wts.reduce((a, b) => a + b, 0);
        avgInterval      = recent.reduce((s, v, i) => s + v * wts[i], 0) / wSum;

        // --- Step 3: Consistency metric (Coefficient of Variation) ---
        const mean   = allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length;
        stdDev       = Math.sqrt(allIntervals.reduce((a, b) => a + (b - mean) ** 2, 0) / allIntervals.length);
        cv           = stdDev / mean || 0.2;

        // --- Step 4: High-Sensitivity Speed Trend (Slope Regression) ---
        if(recent.length >= 4) {
            const n = recent.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for(let i = 0; i < n; i++) {
                sumX += i;
                sumY += recent[i];
                sumXY += i * recent[i];
                sumX2 += i * i;
            }
            const denominator = (n * sumX2 - sumX * sumX);
            const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
            // Slope > 0.6 seconds/spin means interval is growing -> SLOWING
            if(slope > 0.6)       trend = 'SLOWING';
            else if(slope < -0.6) trend = 'SPEEDING';
        }
    }

    // --- Step 5: Pro Logarithmic Momentum Offset ---
    // Logarithmic curve accurately maps physics friction: longer intervals decay faster.
    let baseOffset = 18.0 - (Math.log10(avgInterval / 4.0) * 11.0);
    // Add micro-adjustments for speeding/slowing physics
    if(trend === 'SPEEDING') baseOffset += 1.5;
    else if(trend === 'SLOWING') baseOffset -= 1.5;
    
    let offset = Math.round(Math.max(2, Math.min(18, baseOffset)));

    let speedCategory;
    if(avgInterval < 22)      speedCategory = 'FAST';
    else if(avgInterval < 38) speedCategory = 'MEDIUM';
    else                      speedCategory = 'SLOW';

    // --- Sniper Mode: Sector Size Optimization ---
    let sectorSize;
    if (cv < 0.15 && allIntervals.length >= 5) { // Robotic dealer "Sniper Mode"
        sectorSize = speedCategory === 'FAST' ? 3 : 5; 
    } else {
        const baseSector = speedCategory === 'FAST' ? 6 : speedCategory === 'MEDIUM' ? 8 : 10;
        sectorSize = Math.min(15, baseSector + Math.round(cv * 8));
    }

    // --- Step 6: Gaussian Probability Cloud from Predicted Drop Point ---
    const lastNum = spinHistory[len - 1];
    const lastIdx = ROULETTE_NUMBERS.indexOf(lastNum);
    const sigma   = sectorSize / 2.0; 
    const speedProb = new Array(37).fill(0);
    
    // Dealer/Rotor physics: Ball and wheel rotate in opposite directions, alternating each spin
    const dir = (len % 2 === 0) ? 1 : -1;
    let predictedIdx = (lastIdx + (offset * dir)) % 37;
    if(predictedIdx < 0) predictedIdx += 37;

    for(let n = 0; n <= 36; n++) {
        const nIdx = ROULETTE_NUMBERS.indexOf(n);
        let dist   = Math.abs(nIdx - predictedIdx);
        if(dist > 18) dist = 37 - dist; // Circular distance wrapping
        speedProb[n] = Math.exp(-(dist * dist) / (2 * sigma * sigma));
    }

    // --- Step 7: Recency-weighted Frequency Scoring ---
    const recencyFreq = new Array(37).fill(0);
    const w30 = spinHistory.slice(-30);
    w30.forEach((n, idx) => {
        const age = w30.length - 1 - idx;
        recencyFreq[n] += age < 5 ? 4 : age < 15 ? 2 : 1;
    });
    const freqMax = Math.max(...recencyFreq) || 1;

    // --- Step 8: Markov Chain Validation (Historical Flow) ---
    const markovScores = new Array(37).fill(0);
    for(let i = 0; i < len - 1; i++) {
        if(spinHistory[i] === lastNum) markovScores[spinHistory[i+1]]++;
    }
    const markovMax = Math.max(...markovScores) || 1;

    // --- Step 9: Pro Blending Matrix ---
    // FAST wheels are physically deterministic (ballistics work best). SLOW wheels rely more on patterns/frequency.
    const wSpeed  = speedCategory === 'FAST' ? 0.65 : speedCategory === 'MEDIUM' ? 0.50 : 0.35;
    const wFreq   = speedCategory === 'FAST' ? 0.20 : 0.35;
    const wMarkov = speedCategory === 'FAST' ? 0.15 : 0.30;

    const finalScores = [];
    for(let n = 0; n <= 36; n++) {
        const combined = (speedProb[n]               * wSpeed)
                       + ((recencyFreq[n] / freqMax) * wFreq)
                       + ((markovScores[n] / markovMax) * wMarkov);
        finalScores.push({ num:n, score:combined });
    }
    finalScores.sort((a, b) => b.score - a.score);

    // --- Step 10: Accurate Confidence Scoring ---
    // FAST wheels naturally have much higher confidence. Erratic dealers (CV) destroy confidence.
    const baseConf   = { FAST:85, MEDIUM:65, SLOW:40 }[speedCategory];
    const varPenalty = Math.round(Math.min(35, cv * 70));          
    const trendBonus = trend === 'STABLE' ? 5 : -4;               
    const dataBonus  = Math.min(15, Math.floor(allIntervals.length / 2.5)); 
    const confidence = Math.max(15, Math.min(99, baseConf - varPenalty + trendBonus + dataBonus + (cv < 0.15 ? 15 : 0))); // Sniper bonus

    // --- Format interval for display ---
    const mins2 = Math.floor(avgInterval / 60);
    const secs2 = Math.round(avgInterval % 60);
    const intervalStr = mins2 > 0 ? `${mins2}m${secs2}s` : `${Math.round(avgInterval)}s`;

    return {
        valid: true,
        speedCategory, avgInterval, intervalStr, trend,
        confidence, sectorSize, lastNum, cv, stdDev,
        topNumbers: finalScores.slice(0, 8)
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

    // ---- 4. Wheel Speed Analysis ----
    {
        const ws=computeWheelSpeedData();
        if(ws.valid){
            const ICONS ={FAST:'⚡',MEDIUM:'🌀',SLOW:'🐢'};
            const COLS  ={FAST:'#ff9800',MEDIUM:'#ffd700',SLOW:'#69f0ae'};
            const TREND ={SPEEDING:'↗ Speeding',STABLE:'→ Stable',SLOWING:'↘ Slowing'};
            const TCOL  ={SPEEDING:'#ff9800',STABLE:'#666',SLOWING:'#69f0ae'};
            const confColor=ws.confidence>=65?'#69f0ae':ws.confidence>=45?'#ffd700':'#ff9800';
            const cvColor  =ws.cv<0.25?'#69f0ae':ws.cv<0.45?'#ffd700':'#ff5252';
            const cvLabel  =ws.cv<0.25?'Consistent':ws.cv<0.45?'Variable':'Erratic';
            const top5 = ws.topNumbers.slice(0,5).sort((a,b) => a.num - b.num);
            const nums = top5.map(it => {
                const col=RED_NUMBERS.includes(it.num)?'#ff5252':it.num===0?'#69f0ae':'#ccc';
                return `<span style="color:${col};font-weight:bold">${it.num}</span>`;
            }).join('<span style="color:#2a2a2a;margin:0 2px">·</span>');
            document.getElementById('dealer-sig').innerHTML=
                `<span style="font-size:9px;line-height:1.8">`+
                `<span style="color:${COLS[ws.speedCategory]};font-weight:700">${ICONS[ws.speedCategory]} ${ws.speedCategory}</span>`+
                `<span style="color:#444"> ~${ws.intervalStr} · <span style="color:${confColor}">${ws.confidence}%</span></span><br>`+
                `${nums}<br>`+
                `<span style="color:${TCOL[ws.trend]};font-size:8px">${TREND[ws.trend]}</span>`+
                `<span style="color:${cvColor};font-size:8px"> · ${cvLabel}${ws.cv < 0.15 ? ' 🎯 SNIPER' : ''}</span></span>`;
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
            const top5 = hs.slice(0,5).sort((a,b) => a.num - b.num);
            const nums = top5.map(s => {
                const col=RED_NUMBERS.includes(s.num)?'#ff5252':s.num===0?'#69f0ae':'#ccc';
                return `<span style="color:${col};font-weight:bold">${s.num}</span>`;
            }).join('<span style="color:#333;margin:0 2px">·</span>');
            const need=ws.remaining>0?`⏱️ Need ${ws.remaining} more`:'🔥 Hot';
            document.getElementById('dealer-sig').innerHTML=
                `<span style="font-size:9px;color:#555">${need}</span><br>${nums}`;
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

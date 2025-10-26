let web3, provider, account;
let oldC, newC;

const el = (id) => document.getElementById(id);
const fmt = (v, dec = 18, dp = 6) => {
  try {
    const big = BigInt(v);
    if (dec === 0) return big.toString();
    const s = big.toString().padStart(dec + 1, "0");
    const i = s.slice(0, -dec);
    let d = s.slice(-dec).replace(/0+$/, "");
    return d ? `${i}.${d.slice(0, dp)}` : i;
  } catch { return v?.toString?.() ?? String(v); }
};
const ts2str = (t) => (t && Number.isFinite(Number(t)) ? new Date(Number(t) * 1000).toLocaleString() : "-");
const dd = (sec) => (sec>0 ? `${Math.ceil(sec/86400)} วัน` : "0 วัน");

function toast(msg, type="info") {
  const box = el("toast");
  box.style.display = "block";
  box.textContent = msg;
  box.style.borderColor = type==="ok" ? "#225b2a" : type==="err" ? "#5b2222" : "#1b1c25";
  setTimeout(()=>{ box.style.display="none"; }, 3500);
}

async function connect() {
  try {
    provider = window.ethereum || window.bitkeep?.ethereum || window.okxwallet?.ethereum || window.bitget?.ethereum;
    if (!provider) return toast("❌ ไม่พบกระเป๋า (MetaMask/OKX/Bitget)", "err");
    await provider.request({ method: "eth_requestAccounts" });
    web3 = new Web3(provider);

    const chainIdHex = await provider.request({ method: "eth_chainId" });
    if (chainIdHex !== window.NETWORK.chainIdHex) {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: window.NETWORK.chainIdHex }] });
    }

    const accs = await web3.eth.getAccounts();
    account = accs[0];
    el("wallet").textContent = `✅ ${account.slice(0,6)}...${account.slice(-4)}`;
    el("caOld").textContent = window.ADDR.OLD;
    el("caNew").textContent = window.ADDR.NEW;

    oldC = new web3.eth.Contract(window.OLD_ABI, window.ADDR.OLD);
    newC = new web3.eth.Contract(window.NEW_ABI, window.ADDR.NEW);

    provider.on?.("accountsChanged", () => location.reload());
    provider.on?.("chainChanged", () => location.reload());

    hydrateRef();
    updateMyRefLink();
    await loadSystemNew();
    await refreshRefRewards();
    await loadStakes();

    toast("เชื่อมต่อสำเร็จ", "ok");
  } catch (e) {
    console.error(e);
    toast("เชื่อมต่อไม่สำเร็จ: " + (e?.message || e), "err");
  }
}

// -------- Referrer --------
function hydrateRef() {
  const u = new URL(location.href);
  const ref = u.searchParams.get("ref") || localStorage.getItem("kjc_ref") || "";
  if (ref) el("refInput").value = ref;
}
async function lockRef() {
  try {
    const r = el("refInput").value.trim();
    if (!web3.utils.isAddress(r)) return toast("Referrer ไม่ถูกต้อง", "err");
    await newC.methods.setReferrer(r).send({ from: account });
    localStorage.setItem("kjc_ref", r);
    toast("บันทึก Referrer (สัญญาใหม่) แล้ว", "ok");
  } catch (e) {
    toast("บันทึก Referrer ไม่สำเร็จ: " + (e?.message || e), "err");
  }
}
function updateMyRefLink() {
  if (!account) return;
  const link = `${location.origin}${location.pathname}?ref=${account}`;
  const input = el("myRefLink");
  input.value = link;
  el("btnCopyMyRef").onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast("คัดลอกลิงก์แล้ว ✅","ok"); }
    catch { toast("คัดลอกไม่สำเร็จ (คัดลอกเองได้)", "err"); }
  };
}

// -------- System params (New) -------
async function loadSystemNew() {
  try {
    const paused = await newC.methods.paused().call();
    const apr = await newC.methods.REWARD_APR_BPS().call();
    const stakeInt = await newC.methods.CLAIM_INTERVAL_STAKE().call();
    const lockDur = await newC.methods.LOCK_DURATION().call();
    const refInt = await newC.methods.REF_CLAIM_INTERVAL().call();
    el("sysState").textContent = paused ? "⛔ Paused" : "✅ Live";
    el("aprBps").textContent = `${apr} BPS`;
    el("stakeInt").textContent = `${dd(Number(stakeInt))}`;
    el("lockDur").textContent = `${dd(Number(lockDur))}`;
    el("refInt").textContent = `${dd(Number(refInt))}`;
  } catch {
    el("sysState").textContent = "—";
  }
}

// -------- Referral rewards (Old + New) --------
async function refreshRefRewards() {
  try {
    const [aOld, aNew] = await Promise.all([
      oldC.methods.accruedRefUSDT(account).call().catch(()=> "0"),
      newC.methods.accruedRefUSDT(account).call().catch(()=> "0"),
    ]);
    el("refUsdtOld").textContent = `${fmt(aOld, window.DECIMALS.USDT)} USDT`;
    el("refUsdtNew").textContent = `${fmt(aNew, window.DECIMALS.USDT)} USDT`;

    // countdown เคลม
    const now = Math.floor(Date.now()/1000);
    const [lastOld, intOld, lastNew, intNew] = await Promise.all([
      oldC.methods.lastRefClaimAt(account).call().catch(()=> "0"),
      oldC.methods.REF_CLAIM_INTERVAL().call().catch(()=> "259200"),
      newC.methods.lastRefClaimAt?.(account).call?.().catch?.(()=> "0") ?? "0",
      newC.methods.REF_CLAIM_INTERVAL().call().catch(()=> "0"),
    ]);
    const nextOld = Number(lastOld) + Number(intOld);
    const nextNew = Number(lastNew) + Number(intNew);
    el("refCdOld").textContent = nextOld <= now ? "พร้อมเคลม" : `อีก ~${dd(nextOld-now)}`;
    el("refCdNew").textContent = nextNew <= now ? "พร้อมเคลม" : `อีก ~${dd(nextNew-now)}`;
  } catch (e) {
    console.error(e);
  }
}
async function claimRef(which) {
  try {
    if (which === "old") {
      await oldC.methods.claimReferralReward().send({ from: account });
    } else {
      await newC.methods.claimReferralReward().send({ from: account });
    }
    toast("✅ เคลม Referral สำเร็จ", "ok");
    await refreshRefRewards();
  } catch (e) {
    toast("❌ เคลมไม่สำเร็จ: " + (e?.message || e), "err");
  }
}

// -------- Stakes (merge Old + New) --------
async function loadStakes() {
  const box = el("stakes");
  box.innerHTML = "⏳ กำลังโหลด...";
  try {
    const [cntOld, cntNew] = await Promise.all([
      oldC.methods.getStakeCount(account).call().catch(()=> "0"),
      newC.methods.getStakeCount(account).call().catch(()=> "0"),
    ]);

    const lockOld = await oldC.methods.LOCK_DURATION().call().catch(()=> "15552000"); // 180d
    const lockNew = await newC.methods.LOCK_DURATION().call().catch(()=> "15552000");

    const items = [];
    // Old
    for (let i=0; i<Number(cntOld); i++) {
      const s = await oldC.methods.stakes(account, i).call();
      const pend = await oldC.methods.pendingStakeReward(account, i).call().catch(()=> "0");
      const next = await oldC.methods.nextStakeClaimTime(account, i).call().catch(()=> "0");
      const canU = await oldC.methods.canUnstake(account, i).call().catch(()=> false);
      items.push({ src:"old", i, s, pend, next, lock: lockOld });
    }
    // New
    for (let i=0; i<Number(cntNew); i++) {
      const s = await newC.methods.stakes(account, i).call();
      const pend = await newC.methods.pendingStakeReward(account, i).call().catch(()=> "0");
      const next = await newC.methods.nextStakeClaimTime(account, i).call().catch(()=> "0");
      const canU = await newC.methods.canUnstake(account, i).call().catch(()=> false);
      items.push({ src:"new", i, s, pend, next, lock: lockNew });
    }

    if (items.length === 0) {
      el("totals").textContent = "รวม Principal: 0 KJC • รอเคลม: 0 KJC";
      box.innerHTML = "<div class='muted'>ยังไม่มีรายการ</div>";
      return;
    }

    let totalP = 0n, totalR = 0n;
    const now = Math.floor(Date.now()/1000);
    box.innerHTML = "";
    for (const it of items) {
      totalP += BigInt(it.s.amount||0);
      totalR += BigInt(it.pend||0);

      const unlock = Number(it.s.startTime) + Number(it.lock||0);
      const daysRemain = Math.max(0, Math.ceil((unlock - now)/86400));
      const div = document.createElement("div");
      div.className = "stake";
      div.innerHTML = `
        <div class="mono">[${it.src.toUpperCase()}] Index #${it.i}</div>
        <div>Principal: ${fmt(it.s.amount, window.DECIMALS.KJC)} KJC</div>
        <div>รอเคลม: ${fmt(it.pend, window.DECIMALS.KJC)} KJC</div>
        <div class="muted">เริ่ม: ${ts2str(it.s.startTime)} | เคลมถัดไป: ${ts2str(it.next)}</div>
        <div class="muted">ครบล็อก: ${ts2str(unlock)} (${daysRemain} วัน)</div>
        <div class="row">
          <button class="btnClaim" data-src="${it.src}" data-i="${it.i}" ${it.s.withdrawn ? "disabled":""}>เคลม</button>
          <button class="btnUnstake" data-src="${it.src}" data-i="${it.i}" ${(it.s.withdrawn||unlock>now) ? "disabled":""}>Unstake</button>
        </div>
      `;
      box.appendChild(div);
    }

    el("totals").textContent = `รวม Principal: ${fmt(totalP, window.DECIMALS.KJC)} KJC • รอเคลม: ${fmt(totalR, window.DECIMALS.KJC)} KJC`;

    // bind
    document.querySelectorAll(".btnClaim").forEach(btn=>{
      btn.onclick = async ()=>{
        try {
          const src = btn.dataset.src, i = Number(btn.dataset.i);
          if (src==="old") await oldC.methods.claimStakingReward(i).send({ from: account });
          else await newC.methods.claimStakingReward(i).send({ from: account });
          toast("✅ เคลมสำเร็จ","ok");
          await loadStakes();
        } catch(e){ toast("❌ เคลมไม่สำเร็จ: " + (e?.message||e),"err"); }
      };
    });
    document.querySelectorAll(".btnUnstake").forEach(btn=>{
      btn.onclick = async ()=>{
        try {
          const src = btn.dataset.src, i = Number(btn.dataset.i);
          if (src==="old") await oldC.methods.unstake(i).send({ from: account });
          else await newC.methods.unstake(i).send({ from: account });
          toast("✅ Unstake สำเร็จ","ok");
          await loadStakes();
        } catch(e){ toast("❌ Unstake ไม่สำเร็จ: " + (e?.message||e),"err"); }
      };
    });

  } catch (e) {
    console.error(e);
    box.innerHTML = "❌ โหลดข้อมูลไม่สำเร็จ";
  }
}

// ------ bootstrap ------
window.addEventListener("DOMContentLoaded", ()=>{
  el("btnConnect").addEventListener("click", connect);
  el("btnLockRef").addEventListener("click", lockRef);
  el("btnClaimRefOld").addEventListener("click", ()=> claimRef("old"));
  el("btnClaimRefNew").addEventListener("click", ()=> claimRef("new"));
});

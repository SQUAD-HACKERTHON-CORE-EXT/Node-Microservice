import {
  getSession,
  setSession,
  clearSession,
} from "../services/ussdSessionService.js";
import { sendSMS } from "../services/emailService.js";
import axios from "axios";
import config from "../config/dotenv.js";

const DJANGO = config.DJANGO_API_URL;
const INTERNAL = { "X-Internal-Secret": config.DJANGO_API_SECRET };

function normalizePhone(raw) {
  // Strip everything that isn't a digit or leading +
  const hasPlus = String(raw).startsWith("+");
  const clean = String(raw).replace(/\D/g, "");

  // Already full E.164 digits: 2348012345678 (13 digits)
  if (clean.startsWith("234") && clean.length === 13) return `+${clean}`;

  // Local with leading zero: 08012345678 (11 digits)
  if (clean.startsWith("0") && clean.length === 11)
    return `+234${clean.slice(1)}`;

  // Local without leading zero: 8012345678 (10 digits)
  if (clean.length === 10 && !clean.startsWith("0")) return `+234${clean}`;

  // Already had + and looks right: +2348012345678
  if (hasPlus && clean.length === 13) return `+${clean}`;

  // Fallback — return as-is with + if it had one
  return hasPlus ? `+${clean}` : clean;
}

async function djangoGet(path, params = {}) {
  const res = await axios.get(`${DJANGO}${path}`, {
    params,
    headers: INTERNAL,
    timeout: 15000,
  });
  return res.data;
}

async function djangoPost(path, body = {}) {
  const res = await axios.post(`${DJANGO}${path}`, body, {
    headers: INTERNAL,
    timeout: 8000,
  });
  return res.data;
}

export async function handleUSSD(req, res) {
  const { sessionId, text } = req.body;
  const phoneNumber = normalizePhone(req.body.phoneNumber ?? "");

  const parts = text ? text.split("*") : [];
  const input = parts[parts.length - 1];

  let session = await getSession(sessionId);
  let response = "";

  try {
    // ════════════════════════════════════════════════════
    // ENTRY — verify user exists before showing anything
    // ════════════════════════════════════════════════════
    if (!text || text === "") {
      let user;
      try {
        user = await djangoGet("/api/wallets/", { phone: phoneNumber });
      } catch (err) {
        const status = err.response?.status;
        const detail = err.response?.data
          ? JSON.stringify(err.response.data)
          : err.message;
        console.error(
          `❌ USSD wallet lookup failed for ${phoneNumber} | status: ${status} | detail: ${detail}`,
        );

        // Only bounce for 404 (genuinely not registered)
        // For everything else (500, timeout, auth error) show a service error
        if (status === 404) {
          await clearSession(sessionId);
          return res
            .set("Content-Type", "text/plain")
            .send(
              `END You don't have a Kolliq account yet.\n\nRegister via:\n• WhatsApp: wa.me/2348XXXXXXX\n• App: kolliq.app\n\nCome back after signing up!`,
            );
        }

        await clearSession(sessionId);
        return res
          .set("Content-Type", "text/plain")
          .send(
            `END Service temporarily unavailable.\nPlease try again in a moment.`,
          );
      }

      // User verified — store name for personalisation if available
      session = {
        state: "main_menu",
        data: { phone: phoneNumber, name: user.name ?? "" },
      };
      await setSession(sessionId, session);
      const greeting = session.data.name
        ? `Hi ${session.data.name.split(" ")[0]}!`
        : "Welcome back!";
      response = `CON ${greeting} Kolliq 🌟

1. Wallet & Finance
2. Marketplace
3. Jobs
0. Exit`;
    }

    // ════════════════════════════════════════════════════
    // MAIN MENU
    // ════════════════════════════════════════════════════
    else if (session.state === "main_menu") {
      if (input === "1") {
        session.state = "finance_menu";
        await setSession(sessionId, session);
        response = `CON Wallet & Finance

1. Check Balance
2. Savings Balance
3. Loan Status
4. Repay Loan
0. Back`;
      } else if (input === "2") {
        session.state = "market_menu";
        await setSession(sessionId, session);
        response = `CON Marketplace

1. Browse Listings
2. My Listings
3. Create Listing
4. My Enquiries
0. Back`;
      } else if (input === "3") {
        session.state = "jobs_menu";
        await setSession(sessionId, session);
        response = `CON Jobs

1. Find Available Jobs
2. Accept Job by ID
3. Check Job Status
0. Back`;
      } else if (input === "0") {
        await clearSession(sessionId);
        response = `END Goodbye! Dial again anytime.`;
      } else {
        response = `CON Invalid choice.

1. Wallet & Finance
2. Marketplace
3. Jobs
0. Exit`;
      }
    }

    // ════════════════════════════════════════════════════
    // FINANCE SUB-MENU
    // ════════════════════════════════════════════════════
    else if (session.state === "finance_menu") {
      // 1. Check Balance → GET /api/wallets/
      if (input === "1") {
        try {
          const wallet = await djangoGet("/api/wallets/", {
            phone: phoneNumber,
          });
          await clearSession(sessionId);
          response = `END 💰 Kolliq Balance

Account: ${wallet.virtual_account_number ?? "N/A"}
Wallet: ₦${wallet.balance ?? "0.00"}
Savings: ₦${wallet.savings_balance ?? "0.00"}
Score: ${wallet.eis_score ?? 0}/100`;
        } catch {
          await clearSession(sessionId);
          response = `END Could not fetch balance. Try again.`;
        }
      }

      // 2. Savings Balance → GET /api/financial/savings/
      else if (input === "2") {
        try {
          const savings = await djangoGet("/api/financial/savings/", {
            phone: phoneNumber,
          });
          await clearSession(sessionId);
          response = `END 💳 Savings

Balance: ₦${savings.balance ?? "0.00"}
Interest: 5% p.a.

Deposit/withdraw via
WhatsApp or the app.`;
        } catch {
          await clearSession(sessionId);
          response = `END Could not fetch savings. Try again.`;
        }
      }

      // 3. Loan Status → GET /api/financial/loans/
      else if (input === "3") {
        try {
          const loans = await djangoGet("/api/financial/loans/", {
            phone: phoneNumber,
          });
          const active = Array.isArray(loans)
            ? loans.find((l) => l.status === "active")
            : loans;
          if (!active || !active.amount) {
            await clearSession(sessionId);
            response = `END 📋 Loan Status

No active loan found.
Apply via WhatsApp or
the app.`;
          } else {
            await clearSession(sessionId);
            response = `END 📋 Active Loan

Amount: ₦${Number(active.amount).toLocaleString()}
Remaining: ₦${Number(active.remaining_balance ?? active.amount).toLocaleString()}
Next Due: ${active.next_due_date ?? "Monday"}
Status: ${active.status}`;
          }
        } catch {
          await clearSession(sessionId);
          response = `END Could not fetch loan. Try again.`;
        }
      }

      // 4. Repay Loan → amount input → POST /api/financial/loans/repay/
      else if (input === "4") {
        session.state = "loan_repay_amount";
        await setSession(sessionId, session);
        response = `CON Loan Repayment
Enter amount to repay (₦):`;
      } else if (input === "0") {
        session.state = "main_menu";
        await setSession(sessionId, session);
        response = `CON Kolliq Menu

1. Wallet & Finance
2. Marketplace
3. Jobs
0. Exit`;
      } else {
        response = `CON Invalid choice.

1. Check Balance
2. Savings Balance
3. Loan Status
4. Repay Loan
0. Back`;
      }
    }

    // Loan repayment amount → POST /api/financial/loans/repay/
    else if (session.state === "loan_repay_amount") {
      const amount = parseInt(input.replace(/\D/g, ""));
      if (!amount || amount < 1) {
        response = `CON Enter a valid amount (₦):`;
      } else {
        try {
          const result = await djangoPost("/api/financial/loans/repay/", {
            phone: phoneNumber,
            amount,
          });
          await clearSession(sessionId);
          response = `END ✅ Repayment Recorded!

Paid: ₦${amount.toLocaleString()}
Remaining: ₦${result.remaining_balance ?? 0}

Early repayment boosts
your score! 📈`;
        } catch (err) {
          const detail =
            err.response?.data?.error ??
            err.response?.data?.detail ??
            err.message ??
            "unknown";
          console.error("Loan repay failed:", detail);
          await clearSession(sessionId);
          response = `END ❌ Repayment failed.
${String(detail).slice(0, 80)}
Try again.`;
        }
      }
    }

    // ════════════════════════════════════════════════════
    // MARKETPLACE SUB-MENU
    // ════════════════════════════════════════════════════
    else if (session.state === "market_menu") {
      // 1. Browse Listings → GET /api/marketplace/listings/
      if (input === "1") {
        try {
          const data = await djangoGet("/api/marketplace/listings/");
          const listings = Array.isArray(data) ? data : (data.results ?? []);
          if (!listings.length) {
            await clearSession(sessionId);
            response = `END No listings available now.
Check back later.`;
          } else {
            const list = listings
              .slice(0, 3)
              .map(
                (l, i) =>
                  `${i + 1}. ${l.title ?? l.name ?? "Item"} - ₦${Number(l.price ?? 0).toLocaleString()}`,
              )
              .join("\n");
            session.state = "market_browse_choice";
            session.data.listings = listings.slice(0, 3);
            await setSession(sessionId, session);
            response = `CON Listings:\n\n${list}\n\nPick number for details
0. Back`;
          }
        } catch {
          await clearSession(sessionId);
          response = `END Could not load listings. Try again.`;
        }
      }

      // 2. My Listings → GET /api/marketplace/listings/mine/
      else if (input === "2") {
        try {
          const data = await djangoGet("/api/marketplace/listings/mine/", {
            phone: phoneNumber,
          });
          const listings = Array.isArray(data) ? data : (data.results ?? []);
          if (!listings.length) {
            await clearSession(sessionId);
            response = `END You have no listings yet.
Create one via the app
or WhatsApp.`;
          } else {
            const list = listings
              .slice(0, 3)
              .map(
                (l, i) =>
                  `${i + 1}. ${l.title ?? l.name ?? "Item"}\n   ₦${Number(l.price ?? 0).toLocaleString()} | ${l.status ?? "active"}`,
              )
              .join("\n");
            await clearSession(sessionId);
            response = `END My Listings:\n\n${list}`;
          }
        } catch {
          await clearSession(sessionId);
          response = `END Could not load listings. Try again.`;
        }
      }

      // 3. Create Listing → title → price → category
      else if (input === "3") {
        session.state = "listing_title";
        await setSession(sessionId, session);
        response = `CON New Listing
Enter item name:
e.g. Used Generator`;
      }

      // 4. My Enquiries → GET /api/marketplace/enquiries/mine/
      else if (input === "4") {
        try {
          const data = await djangoGet("/api/marketplace/enquiries/mine/", {
            phone: phoneNumber,
          });
          const enquiries = Array.isArray(data) ? data : (data.results ?? []);
          if (!enquiries.length) {
            await clearSession(sessionId);
            response = `END No enquiries yet.
Browse listings to enquire.`;
          } else {
            const list = enquiries
              .slice(0, 3)
              .map(
                (e, i) =>
                  `${i + 1}. ${e.listing_title ?? "Item"} - ${e.status ?? "pending"}`,
              )
              .join("\n");
            await clearSession(sessionId);
            response = `END My Enquiries:\n\n${list}`;
          }
        } catch {
          await clearSession(sessionId);
          response = `END Could not load enquiries. Try again.`;
        }
      } else if (input === "0") {
        session.state = "main_menu";
        await setSession(sessionId, session);
        response = `CON Kolliq Menu

1. Wallet & Finance
2. Marketplace
3. Jobs
0. Exit`;
      } else {
        response = `CON Invalid choice.

1. Browse Listings
2. My Listings
3. Create Listing
4. My Enquiries
0. Back`;
      }
    }

    // Listing browse: pick one → see detail → enquire
    else if (session.state === "market_browse_choice") {
      const listings = session.data.listings ?? [];
      const choice = parseInt(input);
      if (input === "0") {
        session.state = "market_menu";
        await setSession(sessionId, session);
        response = `CON Marketplace

1. Browse Listings
2. My Listings
3. Create Listing
4. My Enquiries
0. Back`;
      } else if (!choice || !listings[choice - 1]) {
        response = `CON Invalid. Pick 1-${listings.length} or 0:`;
      } else {
        const l = listings[choice - 1];
        session.data.selected_listing = l;
        session.state = "market_listing_detail";
        await setSession(sessionId, session);
        response = `CON ${l.title ?? l.name}
Price: ₦${Number(l.price ?? 0).toLocaleString()}
Location: ${l.location ?? "N/A"}

1. Send Enquiry
0. Back`;
      }
    }

    // Send enquiry → POST /api/marketplace/enquiries/
    else if (session.state === "market_listing_detail") {
      const listing = session.data.selected_listing;
      if (input === "1") {
        try {
          await djangoPost("/api/marketplace/enquiries/", {
            listing_id: listing.id,
            buyer_phone: phoneNumber,
            message: "I am interested in this item. Please contact me.",
          });
          await clearSession(sessionId);
          response = `END ✅ Enquiry Sent!

Seller will contact you.
Item: ${listing.title ?? listing.name}`;
        } catch {
          await clearSession(sessionId);
          response = `END ❌ Could not send enquiry. Try again.`;
        }
      } else if (input === "0") {
        session.state = "market_menu";
        await setSession(sessionId, session);
        response = `CON Marketplace

1. Browse Listings
2. My Listings
3. Create Listing
4. My Enquiries
0. Back`;
      } else {
        response = `CON 1. Send Enquiry\n0. Back`;
      }
    }

    // Create listing — step 1: title
    else if (session.state === "listing_title") {
      session.data.listing_title = input.trim();
      session.state = "listing_price";
      await setSession(sessionId, session);
      response = `CON Enter price in ₦:\ne.g. 15000`;
    }

    // Create listing — step 2: price
    else if (session.state === "listing_price") {
      const price = parseInt(input.replace(/\D/g, ""));
      if (!price || price < 1) {
        response = `CON Enter a valid price (₦):`;
      } else {
        session.data.listing_price = price;
        session.state = "listing_category";
        await setSession(sessionId, session);
        response = `CON Category:

1. Food & Provisions
2. Clothing & Fashion
3. Electronics
4. Building Materials
5. Other`;
      }
    }

    // Create listing — step 3: category → POST /api/marketplace/listings/create/
    else if (session.state === "listing_category") {
      const cats = {
        1: "Food & Provisions",
        2: "Clothing & Fashion",
        3: "Electronics",
        4: "Building Materials",
        5: "Other",
      };
      session.data.listing_category = cats[input] || "Other";
      try {
        const listing = await djangoPost("/api/marketplace/listings/create/", {
          seller_phone: phoneNumber,
          title: session.data.listing_title,
          price: session.data.listing_price,
          category: session.data.listing_category,
        });
        await clearSession(sessionId);
        response = `END ✅ Listing Created!

${session.data.listing_title}
₦${session.data.listing_price.toLocaleString()}
ID: ${listing.id ?? "N/A"}

Buyers can now find
your item on Kolliq! 🔥`;
      } catch (err) {
        const detail = err.response?.data?.error ?? err.message ?? "unknown";
        console.error("Create listing failed:", detail);
        await clearSession(sessionId);
        response = `END ❌ Could not create listing.
${String(detail).slice(0, 80)}
Try again.`;
      }
    }

    // ════════════════════════════════════════════════════
    // JOBS SUB-MENU
    // ════════════════════════════════════════════════════
    else if (session.state === "jobs_menu") {
      // 1. Find jobs → GET /api/jobs/fixed/
      if (input === "1") {
        try {
          const jobs = await djangoGet("/api/jobs/feed/", {
            phone: phoneNumber,
          });
          const list = Array.isArray(jobs) ? jobs : [];
          if (!list.length) {
            await clearSession(sessionId);
            response = `END No matching jobs now.
We'll SMS you when one
matches your profile.`;
          } else {
            const lines = list
              .slice(0, 3)
              .map(
                (j, i) =>
                  `${i + 1}. ${j.skill} - ${j.location}\n   ₦${j.pay_per_worker} | ID: ${j.id}`,
              )
              .join("\n");
            session.state = "job_accept_choice";
            session.data.jobs = list.slice(0, 3);
            await setSession(sessionId, session);
            response = `CON Available Jobs:\n\n${lines}\n\nPick number to accept
0. Back`;
          }
        } catch {
          await clearSession(sessionId);
          response = `END Could not fetch jobs. Try again.`;
        }
      }

      // 2. Accept job by ID → POST /api/jobs/accept/
      else if (input === "2") {
        session.state = "job_accept_id";
        await setSession(sessionId, session);
        response = `CON Enter the Job ID to accept:`;
      }

      // 3. Check job status → GET /api/jobs/{job_id}/
      else if (input === "3") {
        session.state = "job_status_id";
        await setSession(sessionId, session);
        response = `CON Enter your Job ID:`;
      } else if (input === "0") {
        session.state = "main_menu";
        await setSession(sessionId, session);
        response = `CON Kolliq Menu

1. Wallet & Finance
2. Marketplace
3. Jobs
0. Exit`;
      } else {
        response = `CON Invalid choice.

1. Find Available Jobs
2. Accept Job by ID
3. Check Job Status
0. Back`;
      }
    }

    // Accept job from list
    else if (session.state === "job_accept_choice") {
      const jobs = session.data.jobs ?? [];
      const choice = parseInt(input);
      if (input === "0") {
        session.state = "jobs_menu";
        await setSession(sessionId, session);
        response = `CON Jobs

1. Find Available Jobs
2. Accept Job by ID
3. Check Job Status
0. Back`;
      } else if (!choice || !jobs[choice - 1]) {
        response = `CON Invalid. Pick 1-${jobs.length} or 0:`;
      } else {
        const job = jobs[choice - 1];
        try {
          await djangoPost("/api/jobs/accept/", {
            job_id: job.id,
            worker_phone: phoneNumber,
          });
          await sendSMS(
            phoneNumber,
            `✅ Kolliq: Job accepted!\n${job.skill} in ${job.location}\nPay: ₦${job.pay_per_worker}\nJob ID: ${job.id}\nBe on time! 💪`,
          );
          await clearSession(sessionId);
          response = `END ✅ Job Accepted!

${job.skill} - ${job.location}
Pay: ₦${job.pay_per_worker}
ID: ${job.id}

SMS confirmation sent. 💪`;
        } catch {
          await clearSession(sessionId);
          response = `END ❌ Could not accept job. Try again.`;
        }
      }
    }

    // Accept job by typed ID → POST /api/jobs/accept/
    else if (session.state === "job_accept_id") {
      try {
        await djangoPost("/api/jobs/accept/", {
          job_id: input.trim(),
          worker_phone: phoneNumber,
        });
        await sendSMS(
          phoneNumber,
          `✅ Kolliq: Job ${input.trim()} accepted!\nEmployer notified. Be on time! 💪`,
        );
        await clearSession(sessionId);
        response = `END ✅ Job ${input.trim()} Accepted!

Employer notified.
SMS confirmation sent. 💪`;
      } catch (err) {
        const detail = err.response?.data?.error ?? err.message ?? "unknown";
        await clearSession(sessionId);
        response = `END ❌ Could not accept job.
${String(detail).slice(0, 80)}
Check your Job ID.`;
      }
    }

    // Check job status by ID → GET /api/jobs/{job_id}/
    else if (session.state === "job_status_id") {
      try {
        const job = await djangoGet(`/api/jobs/${input.trim()}/`);
        await clearSession(sessionId);
        response = `END Job ${input.trim()}

Status: ${job.status}
Skill: ${job.skill}
Location: ${job.location}
Pay: ₦${job.pay_per_worker ?? "N/A"}`;
      } catch {
        await clearSession(sessionId);
        response = `END Job not found.
Check your Job ID.`;
      }
    }

    // ════════════════════════════════════════════════════
    // FALLBACK
    // ════════════════════════════════════════════════════
    else {
      await clearSession(sessionId);
      response = `END Session error. Please dial again.`;
    }
  } catch (err) {
    console.error("USSD error:", err.message);
    await clearSession(sessionId);
    response = `END Something went wrong. Please try again.`;
  }

  res.set("Content-Type", "text/plain");
  res.send(response);
}

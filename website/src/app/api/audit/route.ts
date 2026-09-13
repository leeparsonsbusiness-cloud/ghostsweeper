import { NextRequest, NextResponse } from "next/server";
import { 
  classifyAccountBatch, 
  ClassifiedAccount, 
  AccountForensicInput,
  ClassificationGender 
} from "@/lib/classifier";

import { ApifyClient } from "apify-client";
import { 
  getAuditCache, 
  saveAuditCache, 
  getAuditCacheAsync,
  saveAuditCacheAsync,
  isAuditUnlocked, 
  isAuditUnlockedAsync,
  normalizeTargetUsername,
  getUserPlanAndUsage,
  getUserPlanAndUsageAsync,
  recordUserSearch,
  recordFollowsSnapshot,
  getFollowsDiff,
  recordActivityEvents,
  DiffResult,
  RadarActivityEvent
} from "@/lib/db";


export const maxDuration = 60;
export const dynamic = "force-dynamic";

export type AuditAccountItem = ClassifiedAccount;

export interface DiffSummary {
  newFollowsCount: number;
  unfollowedCount: number;
  isBaseline: boolean;
  baselineTimestamp?: string;
  baselineCount: number;
}

export interface ActivitySummary {
  girlsCount: number;
  girlsPct: number;
  guysCount: number;
  guysPct: number;
  recentActivityIndex: string;
}

export type TargetType = "following" | "followers";

export interface DemographicSplit {
  malePct: number;
  femalePct: number;
  brandPct?: number;
  inactivePct: number;
  maleCount: number;
  femaleCount: number;
  brandCount?: number;
  inactiveCount: number;
  formatted: string;
  male: number;
  female: number;
  brand?: number;
  inactiveOver90d: number;
  nonFollowers: number;
  totalAudited: number;
}

export interface GhostAndBotMetrics {
  count: number;
  reachSuppression: number;
  reachPenaltyFormatted: string;
}

export interface TargetTypeMetrics {
  targetType: TargetType;
  totalCount: number;
  demographics: DemographicSplit;
  ghostCount: number;
  nonReciprocalsCount: number;
  reachPenalty: number;
  lockedCount: number;
  sampleAccounts: ClassifiedAccount[];
  allAccounts?: ClassifiedAccount[];
}

export interface AuditResult {
  username: string;
  fullName: string;
  full_name: string;
  avatar: string;
  profile_pic_url: string;
  isVerified: boolean;
  is_verified: boolean;
  isPrivate?: boolean;
  bio?: string;
  biography?: string;
  isLiveRealData: boolean;
  postCount: number;
  followers: number;
  follower_count: number;
  following: number;
  following_count: number;
  avgLikes: number;
  avgComments: number;
  ratio: number;
  ratioRating: "Poor" | "Fair" | "Healthy" | "Elite";
  healthScore: number;
  reachPenalty: number;
  targetType: TargetType;
  nonReciprocals: number;
  estimatedGhosts: number;
  lockedCount: number;
  isUnlocked: boolean;
  activitySummary: ActivitySummary;
  ghostsAndBots: GhostAndBotMetrics;
  demographics: DemographicSplit;
  sampleAccounts: ClassifiedAccount[];
  allAccounts?: ClassifiedAccount[];
  followingMetrics: TargetTypeMetrics;
  followersMetrics: TargetTypeMetrics;
  diffSummary?: DiffSummary;
  recommendations: string[];
}

/**
 * Clean Instagram Handle (remove '@', whitespace, URL prefixes)
 */
function cleanHandle(raw: string): string {
  let cleaned = raw
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  // If user entered "Lee Parsons" or "lee parsons", resolve to founder profile
  if (cleaned === "lee parsons" || cleaned === "the lee parsons") {
    return "theleeparsons";
  }

  // Strip all internal whitespace for valid IG handle format
  cleaned = cleaned.replace(/\s+/g, "");
  return normalizeTargetUsername(cleaned);
}

interface TargetProfileData {
  username: string;
  fullName: string;
  avatar: string;
  bio: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isVerified: boolean;
  isPrivate: boolean;
}

/**
 * Fetch true Instagram profile metadata (real follower/following counts, bio, HD avatar)
 */
async function scrapeTargetProfileWithApify(
  cleanUser: string,
  client: ApifyClient
): Promise<TargetProfileData | null> {
  try {
    const run = await client.actor("apify/instagram-profile-scraper").call(
      { usernames: [cleanUser] },
      { waitSecs: 45 }
    );
    if (run?.defaultDatasetId) {
      const dataset = await client.dataset(run.defaultDatasetId).listItems();
      if (dataset.items && dataset.items.length > 0) {
        const item: any = dataset.items[0];
        const rawAvatar = item.profilePicUrlHD || item.profilePicUrl || item.avatar || "";
        const proxiedAvatar = rawAvatar ? `/api/proxy-image?url=${encodeURIComponent(rawAvatar)}` : "";
        return {
          username: item.username || cleanUser,
          fullName: item.fullName || item.full_name || cleanUser,
          avatar: proxiedAvatar,
          bio: item.biography || item.bio || "",
          followersCount: item.followersCount ?? item.follower_count ?? 0,
          followingCount: item.followsCount ?? item.followingCount ?? item.following_count ?? 0,
          postsCount: item.postsCount ?? item.media_count ?? 0,
          isVerified: Boolean(item.verified || item.isVerified || item.is_verified),
          isPrivate: Boolean(item.isPrivate || item.is_private),
        };
      }
    }
  } catch (err: any) {
    console.warn("[Profile Scraper] Warning:", err.message);
  }
  return null;
}

/**
 * Execute Apify Instagram Scraper with full profile URLs and safe array unwrapping
 */
async function scrapeInstagramWithApify(
  cleanUser: string,
  targetType: TargetType = "following",
  isPaid: boolean = false,
  client?: ApifyClient
): Promise<{ follows: any[]; targetType: TargetType }> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.error("CRITICAL: APIFY_API_TOKEN is not defined in process.env");
    throw new Error("APIFY_API_TOKEN missing from environment variables");
  }

  const apifyClient = client || new ApifyClient({
    token: token.trim(),
  });

  const actorId = process.env.APIFY_ACTOR_ID || "scraping_solutions/instagram-scraper-followers-following-no-cookies";
  const limit = isPaid ? 150 : 25;
  const dataToScrape = targetType === "followers" ? "Followers" : "Followings";

  const input = {
    Account: [cleanUser],
    usernames: [cleanUser],
    dataToScrape: dataToScrape,
    resultsLimit: limit,
  };

  console.log("Calling Apify follows scraper with payload:", JSON.stringify(input));

  const run = await apifyClient.actor(actorId).call(input, {
    waitSecs: 60,
  });

  if (!run || !run.defaultDatasetId) {
    throw new Error(`Apify actor run failed to initialize dataset. Status: ${run?.status || "UNKNOWN"}`);
  }

  const dataset = await apifyClient.dataset(run.defaultDatasetId).listItems();
  const items = dataset.items || [];
  console.log("Dataset items returned count:", items.length);

  // Safe array unwrapping for varying dataset structures
  let follows = items;
  if (items.length === 1 && Array.isArray((items[0] as any).following)) {
    follows = (items[0] as any).following;
  } else if (items.length === 1 && Array.isArray((items[0] as any).followers)) {
    follows = (items[0] as any).followers;
  } else if (items.length === 1 && Array.isArray((items[0] as any).data)) {
    follows = (items[0] as any).data;
  } else if (items.length === 1 && Array.isArray((items[0] as any).results)) {
    follows = (items[0] as any).results;
  }

  if (!follows || follows.length === 0) {
    throw new Error(`Account @${cleanUser} is private or has no public follows visible.`);
  }

  return { follows, targetType };
}

/**
 * Build structured AuditResult directly from live Apify items with Snapshot Diff Engine
 */
function buildLiveAuditResult(
  cleanUsername: string,
  followingRaw: any[],
  followersRaw: any[],
  targetType: TargetType,
  unlocked: boolean,
  profileData?: TargetProfileData | null
): AuditResult {
  const followersSet = new Set(
    followersRaw.map((f: any) =>
      (f.username || f.handle || "").toLowerCase().replace(/^@/, "").trim()
    )
  );
  const followingSet = new Set(
    followingRaw.map((f: any) =>
      (f.username || f.handle || "").toLowerCase().replace(/^@/, "").trim()
    )
  );

  // Snapshot Diff Calculation
  const followingUsernames = followingRaw.map((item: any) =>
    (item.username || item.handle || "").toLowerCase().replace(/^@/, "").trim()
  ).filter(Boolean);
  const followingDiff = recordFollowsSnapshot(cleanUsername, "following", followingUsernames);
  const newFollowingSet = new Set(followingDiff.newFollows.map((u) => u.toLowerCase()));

  const followersUsernames = followersRaw.map((item: any) =>
    (item.username || item.handle || "").toLowerCase().replace(/^@/, "").trim()
  ).filter(Boolean);
  const followersDiff = recordFollowsSnapshot(cleanUsername, "followers", followersUsernames);
  const newFollowersSet = new Set(followersDiff.newFollows.map((u) => u.toLowerCase()));

  // Map raw Following items into AccountForensicInput array
  const rawFollowingInputs: AccountForensicInput[] = followingRaw.map((item: any, idx: number) => {
    const rawPic = item.profilePicUrl || item.profile_pic_url || item.profilePicUrlHD || item.avatar || "";
    const proxiedAvatar = rawPic ? `/api/proxy-image?url=${encodeURIComponent(rawPic)}` : "";
    const uname = (item.username || item.handle || `user_${idx + 1}`).replace(/^@/, "").trim();
    const fullName = item.fullName || item.full_name || item.name || uname;
    const followsYou = followersSet.has(uname.toLowerCase());
    const isNewFollow = newFollowingSet.has(uname.toLowerCase());

    return {
      username: uname,
      name: fullName,
      bio: item.biography || item.bio || "",
      avatar: proxiedAvatar,
      isVerified: Boolean(item.isVerified || item.is_verified || item.verified),
      isPrivate: Boolean(item.isPrivate || item.is_private),
      postCount: item.postsCount ?? item.media_count ?? 0,
      followersCount: item.followersCount ?? item.follower_count ?? 0,
      followingCount: item.followingCount ?? item.following_count ?? 0,
      followsYou,
      chronologicalRank: idx,
      isNewFollow,
      detectedAt: isNewFollow ? "Today" : undefined,
    };
  });

  // Map raw Followers items into AccountForensicInput array
  const rawFollowersInputs: AccountForensicInput[] = followersRaw.map((item: any, idx: number) => {
    const rawPic = item.profilePicUrl || item.profile_pic_url || item.profilePicUrlHD || item.avatar || "";
    const proxiedAvatar = rawPic ? `/api/proxy-image?url=${encodeURIComponent(rawPic)}` : "";
    const uname = (item.username || item.handle || `user_${idx + 1}`).replace(/^@/, "").trim();
    const fullName = item.fullName || item.full_name || item.name || uname;
    const isNewFollow = newFollowersSet.has(uname.toLowerCase());

    return {
      username: uname,
      name: fullName,
      bio: item.biography || item.bio || "",
      avatar: proxiedAvatar,
      isVerified: Boolean(item.isVerified || item.is_verified || item.verified),
      isPrivate: Boolean(item.isPrivate || item.is_private),
      postCount: item.postsCount ?? item.media_count ?? 0,
      followersCount: item.followersCount ?? item.follower_count ?? 0,
      followingCount: item.followingCount ?? item.following_count ?? 0,
      followsYou: followingSet.has(uname.toLowerCase()),
      chronologicalRank: idx,
      isNewFollow,
      detectedAt: isNewFollow ? "Today" : undefined,
    };
  });

  // Dynamic Chronological Diff Prioritization:
  // 1. Brand new follows detected by the snapshot diff engine are prioritized at the top (Rank #0, #1, ...)
  // 2. Followed by all other accounts in their exact scraped order.
  const followingInputs: AccountForensicInput[] = [
    ...rawFollowingInputs.filter((a) => newFollowingSet.has(a.username.toLowerCase())),
    ...rawFollowingInputs.filter((a) => !newFollowingSet.has(a.username.toLowerCase())),
  ].map((acc, idx) => ({
    ...acc,
    chronologicalRank: idx,
  }));

  const followersInputs: AccountForensicInput[] = [
    ...rawFollowersInputs.filter((a) => newFollowersSet.has(a.username.toLowerCase())),
    ...rawFollowersInputs.filter((a) => !newFollowersSet.has(a.username.toLowerCase())),
  ].map((acc, idx) => ({
    ...acc,
    chronologicalRank: idx,
  }));


  const followingBatch = classifyAccountBatch(followingInputs);
  const followersBatch = classifyAccountBatch(followersInputs.length > 0 ? followersInputs : followingInputs);

  // DolphinRadar Forensic Event Logger: record detected diff events
  const newActivityEvents: RadarActivityEvent[] = [];
  const nowIso = new Date().toISOString();
  const timeFormatted = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  followingBatch.accounts.forEach((acc) => {
    if (acc.isNewFollow) {
      newActivityEvents.push({
        id: `ev_nf_${Date.now()}_${acc.username}`,
        targetUsername: cleanUsername,
        eventType: "NEW_FOLLOW",
        subjectUsername: acc.username,
        subjectName: acc.name,
        subjectAvatar: acc.avatar,
        subjectGender: acc.gender,
        isBrand: Boolean(acc.isBrand),
        isVerified: Boolean(acc.isVerified),
        detectedAt: nowIso,
        timeWindowFormatted: `Detected today at ${timeFormatted}`,
      });
    }
  });

  if (followingDiff && followingDiff.unfollowed && followingDiff.unfollowed.length > 0) {
    followingDiff.unfollowed.forEach((uname) => {
      newActivityEvents.push({
        id: `ev_uf_${Date.now()}_${uname}`,
        targetUsername: cleanUsername,
        eventType: "UNFOLLOW",
        subjectUsername: uname,
        subjectName: uname,
        subjectAvatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(uname)}&background=0284c7&color=fff`,
        subjectGender: "other",
        isBrand: false,
        isVerified: false,
        detectedAt: nowIso,
        timeWindowFormatted: `Detected today at ${timeFormatted}`,
      });
    });
  }

  if (newActivityEvents.length > 0) {
    recordActivityEvents(cleanUsername, newActivityEvents);
  }


  const realFollowersCount = profileData?.followersCount || (followersInputs.length > 0 ? followersInputs.length : 2376);
  const realFollowingCount = profileData?.followingCount || (followingInputs.length > 0 ? followingInputs.length : 2780);
  const ratio = realFollowingCount > 0 ? Number((realFollowersCount / realFollowingCount).toFixed(2)) : 1.0;

  // Following demographics scaled to realFollowingCount
  const fMalePct = followingBatch.summary.malePct;
  const fFemalePct = followingBatch.summary.femalePct;
  const fBrandPct = followingBatch.summary.brandPct || 0;
  const fInactivePct = followingBatch.summary.inactivePct;

  const followingDemographics: DemographicSplit = {
    malePct: fMalePct,
    femalePct: fFemalePct,
    brandPct: fBrandPct,
    inactivePct: fInactivePct,
    maleCount: Math.round((realFollowingCount * fMalePct) / 100),
    femaleCount: Math.round((realFollowingCount * fFemalePct) / 100),
    brandCount: Math.round((realFollowingCount * fBrandPct) / 100),
    inactiveCount: Math.round((realFollowingCount * fInactivePct) / 100),
    formatted: `👨 ${fMalePct}% Male • 👩 ${fFemalePct}% Female • 🏢 ${fBrandPct}% Brands • 🤖 ${fInactivePct}% Bots`,
    male: Math.round((realFollowingCount * fMalePct) / 100),
    female: Math.round((realFollowingCount * fFemalePct) / 100),
    brand: Math.round((realFollowingCount * fBrandPct) / 100),
    inactiveOver90d: Math.round((realFollowingCount * fInactivePct) / 100),
    nonFollowers: followingBatch.accounts.filter((a) => !a.followsYou).length,
    totalAudited: followingBatch.accounts.length,
  };

  // Followers demographics scaled to realFollowersCount
  const foMalePct = followersBatch.summary.malePct;
  const foFemalePct = followersBatch.summary.femalePct;
  const foBrandPct = followersBatch.summary.brandPct || 0;
  const foInactivePct = followersBatch.summary.inactivePct;

  const followersDemographics: DemographicSplit = {
    malePct: foMalePct,
    femalePct: foFemalePct,
    brandPct: foBrandPct,
    inactivePct: foInactivePct,
    maleCount: Math.round((realFollowersCount * foMalePct) / 100),
    femaleCount: Math.round((realFollowersCount * foFemalePct) / 100),
    brandCount: Math.round((realFollowersCount * foBrandPct) / 100),
    inactiveCount: Math.round((realFollowersCount * foInactivePct) / 100),
    formatted: `👨 ${foMalePct}% Male • 👩 ${foFemalePct}% Female • 🏢 ${foBrandPct}% Brands • 🤖 ${foInactivePct}% Bots`,
    male: Math.round((realFollowersCount * foMalePct) / 100),
    female: Math.round((realFollowersCount * foFemalePct) / 100),
    brand: Math.round((realFollowersCount * foBrandPct) / 100),
    inactiveOver90d: Math.round((realFollowersCount * foInactivePct) / 100),
    nonFollowers: followersBatch.accounts.filter((a) => !a.followsYou).length,
    totalAudited: followersBatch.accounts.length,
  };

  const followingSample = followingBatch.accounts.slice(0, 5);
  const followingAll = followingBatch.accounts;

  const followersSample = followersBatch.accounts.slice(0, 5);
  const followersAll = followersBatch.accounts;

  const followingMetrics: TargetTypeMetrics = {
    targetType: "following",
    totalCount: realFollowingCount,
    demographics: followingDemographics,
    ghostCount: followingBatch.summary.ghostCount,
    nonReciprocalsCount: followingBatch.accounts.filter((a) => !a.followsYou).length,
    reachPenalty: 0,
    lockedCount: Math.max(0, followingBatch.accounts.length - followingSample.length),
    sampleAccounts: followingSample,
    allAccounts: followingAll,
  };

  const followersMetrics: TargetTypeMetrics = {
    targetType: "followers",
    totalCount: realFollowersCount,
    demographics: followersDemographics,
    ghostCount: followersBatch.summary.ghostCount,
    nonReciprocalsCount: followersBatch.accounts.filter((a) => !a.followsYou).length,
    reachPenalty: 0,
    lockedCount: Math.max(0, followersBatch.accounts.length - followersSample.length),
    sampleAccounts: followersSample,
    allAccounts: followersAll,
  };

  const activeMetrics = targetType === "followers" ? followersMetrics : followingMetrics;
  const activeDiff = targetType === "followers" ? followersDiff : followingDiff;
  const fallbackAvatar = `/api/proxy-image?url=https%3A%2F%2Fui-avatars.com%2Fapi%2F%3Fname%3D${encodeURIComponent(cleanUsername)}%26background%3D0284c7%26color%3Dfff%26size%3D256`;
  const primaryAvatar = profileData?.avatar || fallbackAvatar;
  let displayFullName = profileData?.fullName || cleanUsername;
  if (cleanUsername === "theleeparsons" && (displayFullName === "🕊️" || !displayFullName || displayFullName === cleanUsername)) {
    displayFullName = "Lee Parsons 🕊️";
  }

  return {
    username: cleanUsername,
    fullName: displayFullName,
    full_name: displayFullName,
    avatar: primaryAvatar,
    profile_pic_url: primaryAvatar,
    isVerified: Boolean(profileData?.isVerified),
    is_verified: Boolean(profileData?.isVerified),
    isPrivate: Boolean(profileData?.isPrivate),
    bio: profileData?.bio || "",
    biography: profileData?.bio || "",
    isLiveRealData: true,
    postCount: profileData?.postsCount ?? followingBatch.accounts.length,
    followers: realFollowersCount,
    follower_count: realFollowersCount,
    following: realFollowingCount,
    following_count: realFollowingCount,
    avgLikes: 85,
    avgComments: 8,
    ratio,
    ratioRating: ratio >= 1.0 ? "Healthy" : "Fair",
    healthScore: 88,
    reachPenalty: 0,
    targetType,
    nonReciprocals: activeMetrics.nonReciprocalsCount,
    estimatedGhosts: activeMetrics.ghostCount,
    lockedCount: activeMetrics.lockedCount,
    isUnlocked: unlocked,
    activitySummary: {
      girlsCount: activeMetrics.demographics.femaleCount,
      girlsPct: activeMetrics.demographics.femalePct,
      guysCount: activeMetrics.demographics.maleCount,
      guysPct: activeMetrics.demographics.malePct,
      recentActivityIndex: activeMetrics.demographics.femalePct > 60 ? "Heavy Female Follow Ratio" : "Normal Activity",
    },
    ghostsAndBots: {
      count: activeMetrics.ghostCount,
      reachSuppression: 0,
      reachPenaltyFormatted: "0%",
    },
    demographics: activeMetrics.demographics,
    sampleAccounts: activeMetrics.sampleAccounts,
    allAccounts: activeMetrics.allAccounts,
    followingMetrics,
    followersMetrics,
    diffSummary: {
      newFollowsCount: activeDiff.newFollows.length,
      unfollowedCount: activeDiff.unfollowed.length,
      isBaseline: activeDiff.isBaseline,
      baselineTimestamp: activeDiff.baselineTimestamp,
      baselineCount: activeDiff.baselineCount,
    },
    recommendations: [
      "View live follow activity & mutual reciprocity",
      "Filter by Girls, Guys, and Brands & Studios",
      "Monitor profile with automated Follow Radar",
    ],
  };
}

function maskResultForPaywall(result: AuditResult, unlocked: boolean): AuditResult {
  if (unlocked) {
    return {
      ...result,
      isUnlocked: true,
      lockedCount: 0,
      followingMetrics: {
        ...result.followingMetrics,
        lockedCount: 0,
      },
      followersMetrics: {
        ...result.followersMetrics,
        lockedCount: 0,
      },
    };
  }

  const sampleFollowing = (result.followingMetrics?.sampleAccounts || []).slice(0, 5);
  const sampleFollowers = (result.followersMetrics?.sampleAccounts || []).slice(0, 5);
  const activeSample = result.targetType === "followers" ? sampleFollowers : sampleFollowing;

  return {
    ...result,
    isUnlocked: false,
    sampleAccounts: activeSample,
    allAccounts: activeSample,
    lockedCount: Math.max(0, (result.targetType === "followers" ? result.followersMetrics?.totalCount : result.followingMetrics?.totalCount) - 5),
    followingMetrics: {
      ...result.followingMetrics,
      sampleAccounts: sampleFollowing,
      allAccounts: sampleFollowing,
      lockedCount: Math.max(0, result.followingMetrics.totalCount - 5),
    },
    followersMetrics: {
      ...result.followersMetrics,
      sampleAccounts: sampleFollowers,
      allAccounts: sampleFollowers,
      lockedCount: Math.max(0, result.followersMetrics.totalCount - 5),
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.APIFY_API_TOKEN) {
      console.error("CRITICAL: APIFY_API_TOKEN is not defined in process.env");
      return NextResponse.json(
        { 
          success: false, 
          error: "APIFY_API_TOKEN missing from environment variables" 
        }, 
        { status: 500 }
      );
    }

    const body = await req.json();
    const rawUsername = body.username || "theleeparsons";
    const cleanUsername = cleanHandle(rawUsername);
    const targetType: TargetType = body.targetType === "followers" || body.type === "followers" ? "followers" : "following";
    const userEmail = body.email || req.cookies.get("gs_session")?.value;
    const forceRefresh = Boolean(body.forceRefresh || body.refresh);

    if (!cleanUsername) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid Instagram username." },
        { status: 400 }
      );
    }

    const unlocked = await isAuditUnlockedAsync(userEmail, cleanUsername);

    // Check 7-day persistent Supabase cache first (<50ms, $0 Apify cost)
    if (!forceRefresh) {
      const cached = await getAuditCacheAsync(cleanUsername, targetType, 7 * 86400);
      if (cached) {
        return NextResponse.json({ success: true, data: maskResultForPaywall(cached, unlocked) });
      }
    }

    // Enforce Plan & Search Limits
    if (userEmail) {
      const usage = await getUserPlanAndUsageAsync(userEmail);
      if (!usage.canSearchTarget(cleanUsername)) {
        if (usage.plan === "standard") {
          return NextResponse.json(
            {
              success: false,
              error: "WEEKLY_LIMIT_REACHED",
              details: "You have reached your 10 weekly searches on the Standard Plan. Upgrade to Pro for 30 searches per week ($9.99/mo).",
              limitReached: true,
              plan: "standard",
              searchesUsed: usage.searchesUsed,
              limit: 10,
              resetsAt: usage.resetsAt,
            },
            { status: 403 }
          );
        } else if (usage.plan === "free") {
          return NextResponse.json(
            {
              success: false,
              error: "FREE_LIMIT_REACHED",
              details: "You have used your 1 free profile search. Unlock to see the truth ($3.99) for full access and 10 searches per week.",
              limitReached: true,
              plan: "free",
              searchesUsed: usage.searchesUsed,
              limit: 1,
            },
            { status: 403 }
          );
        } else if (usage.plan === "unlimited") {
          return NextResponse.json(
            {
              success: false,
              error: "PRO_LIMIT_REACHED",
              details: "You have reached your 30 weekly searches on Pro. Resets weekly.",
              limitReached: true,
              plan: "unlimited",
              searchesUsed: usage.searchesUsed,
              limit: 30,
              resetsAt: usage.resetsAt,
            },
            { status: 403 }
          );
        }
      }
    }

    // Call live Apify scrapers concurrently (Target Profile Details + Target Type ONLY)
    // Only scrape the requested targetType (defaulting to following) to protect credits and prevent timeouts!
    const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN.trim() });
    const [profileData, targetResult] = await Promise.all([
      scrapeTargetProfileWithApify(cleanUsername, client),
      scrapeInstagramWithApify(cleanUsername, targetType, unlocked, client),
    ]);

    const followingRaw = targetType === "following" ? targetResult.follows : [];
    const followersRaw = targetType === "followers" ? targetResult.follows : [];

    const result = buildLiveAuditResult(
      cleanUsername,
      followingRaw,
      followersRaw,
      targetType,
      unlocked,
      profileData
    );

    // Save to shared 7-day Supabase cache & record search usage
    await saveAuditCacheAsync(cleanUsername, targetType, result);
    if (userEmail) {
      recordUserSearch(userEmail, cleanUsername);
    }

    return NextResponse.json({ success: true, data: maskResultForPaywall(result, unlocked) });
  } catch (error: any) {
    console.error("Scraper execution failed:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Scraper failed", 
        details: error instanceof Error ? error.message : String(error) 
      }, 
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!process.env.APIFY_API_TOKEN) {
      console.error("CRITICAL: APIFY_API_TOKEN is not defined in process.env");
      return NextResponse.json(
        { 
          success: false, 
          error: "APIFY_API_TOKEN missing from environment variables" 
        }, 
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const rawUsername = searchParams.get("username") || "theleeparsons";
    const cleanUsername = cleanHandle(rawUsername);
    const targetType: TargetType = searchParams.get("targetType") === "followers" || searchParams.get("type") === "followers" ? "followers" : "following";
    const userEmail = searchParams.get("email") || req.cookies.get("gs_session")?.value;
    const forceRefresh = searchParams.get("forceRefresh") === "true" || searchParams.get("refresh") === "true";

    if (!cleanUsername) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid Instagram username." },
        { status: 400 }
      );
    }

    const unlocked = await isAuditUnlockedAsync(userEmail, cleanUsername);

    // Check 7-day persistent Supabase cache first (<50ms, $0 Apify cost)
    if (!forceRefresh) {
      const cached = await getAuditCacheAsync(cleanUsername, targetType, 7 * 86400);
      if (cached) {
        return NextResponse.json({ success: true, data: maskResultForPaywall(cached, unlocked) });
      }
    }

    // Enforce Plan & Search Limits
    if (userEmail) {
      const usage = await getUserPlanAndUsageAsync(userEmail);
      if (!usage.canSearchTarget(cleanUsername)) {
        if (usage.plan === "standard") {
          return NextResponse.json(
            {
              success: false,
              error: "WEEKLY_LIMIT_REACHED",
              details: "You have reached your 10 weekly searches on the Standard Plan. Upgrade to Pro for 30 searches per week ($9.99/mo).",
              limitReached: true,
              plan: "standard",
              searchesUsed: usage.searchesUsed,
              limit: 10,
              resetsAt: usage.resetsAt,
            },
            { status: 403 }
          );
        } else if (usage.plan === "free") {
          return NextResponse.json(
            {
              success: false,
              error: "FREE_LIMIT_REACHED",
              details: "You have used your 1 free profile search. Unlock to see the truth ($3.99) for full access and 10 searches per week.",
              limitReached: true,
              plan: "free",
              searchesUsed: usage.searchesUsed,
              limit: 1,
            },
            { status: 403 }
          );
        } else if (usage.plan === "unlimited") {
          return NextResponse.json(
            {
              success: false,
              error: "PRO_LIMIT_REACHED",
              details: "You have reached your 30 weekly searches on Pro. Resets weekly.",
              limitReached: true,
              plan: "unlimited",
              searchesUsed: usage.searchesUsed,
              limit: 30,
              resetsAt: usage.resetsAt,
            },
            { status: 403 }
          );
        }
      }
    }

    // Call live Apify scrapers concurrently (Target Profile Details + Target Type ONLY)
    const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN.trim() });
    const [profileData, targetResult] = await Promise.all([
      scrapeTargetProfileWithApify(cleanUsername, client),
      scrapeInstagramWithApify(cleanUsername, targetType, unlocked, client),
    ]);

    const followingRaw = targetType === "following" ? targetResult.follows : [];
    const followersRaw = targetType === "followers" ? targetResult.follows : [];

    const result = buildLiveAuditResult(
      cleanUsername,
      followingRaw,
      followersRaw,
      targetType,
      unlocked,
      profileData
    );

    // Save to shared 7-day Supabase cache & record search usage
    await saveAuditCacheAsync(cleanUsername, targetType, result);
    if (userEmail) {
      recordUserSearch(userEmail, cleanUsername);
    }

    return NextResponse.json({ success: true, data: maskResultForPaywall(result, unlocked) });
  } catch (error: any) {
    console.error("Scraper execution failed:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Scraper failed", 
        details: error instanceof Error ? error.message : String(error) 
      }, 
      { status: 500 }
    );
  }
}

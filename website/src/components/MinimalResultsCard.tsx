"use client";

import React, { useState } from "react";
import { 
  ArrowRight, 
  ChevronDown, 
  ChevronUp, 
  Zap,
  Users,
  Lock,
  Sparkles,
  ShieldCheck,
  Search,
  Download,
  CheckCircle,
  Clock,
  UserCheck,
  Eye,
  UserPlus
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { AuditResult, TargetType } from "@/app/api/audit/route";
import { AuditTabType } from "@/components/MinimalHero";
import { ClassifiedAccount } from "@/lib/classifier";

interface MinimalResultsCardProps {
  auditData: AuditResult;
  activeTab: AuditTabType;
  onSelectTab: (tab: AuditTabType) => void;
  onOpenCheckout: () => void;
  isUnlocked?: boolean;
}

export const MinimalResultsCard: React.FC<MinimalResultsCardProps> = ({
  auditData,
  activeTab,
  onSelectTab,
  onOpenCheckout,
  isUnlocked = false,
}) => {
  const [selectedTargetType, setSelectedTargetType] = useState<TargetType>("following");
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const getScoreBadge = (score: number) => {
    if (score >= 75) {
      return {
        label: "ACTIVE FOLLOWER PATTERN",
        textColor: "text-emerald-600 dark:text-emerald-400",
        bgColor: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60",
      };
    }
    if (score >= 50) {
      return {
        label: "HIGH ACTIVITY RATIO",
        textColor: "text-amber-600 dark:text-amber-400",
        bgColor: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60",
      };
    }
    return {
      label: "HEAVY RECENT ACTIVITY",
      textColor: "text-rose-600 dark:text-rose-400",
      bgColor: "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60",
    };
  };

  const scoreBadge = getScoreBadge(auditData.healthScore);

  // Derive metrics based on selected target type (Following vs. Followers)
  const currentMetrics = selectedTargetType === "followers" 
    ? auditData.followersMetrics 
    : auditData.followingMetrics;

  const totalTargetCount = selectedTargetType === "followers" 
    ? (auditData.followers || auditData.follower_count || 1000) 
    : (auditData.following || auditData.following_count || 1000);

  const totalCount = totalTargetCount;

  // Base pool of accounts
  const allAccounts: ClassifiedAccount[] = currentMetrics?.allAccounts || currentMetrics?.sampleAccounts || [];

  // Filtered pool for Unlocked table (search by handle or name)
  const filteredAccounts = allAccounts.filter((acc) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match = acc.username.toLowerCase().includes(q) || acc.name.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Top 5 preview accounts for the Free state
  const previewAccounts = React.useMemo(() => {
    return (currentMetrics?.sampleAccounts || allAccounts).slice(0, 5);
  }, [currentMetrics?.sampleAccounts, allAccounts]);

  const handleExportCSV = () => {
    const headers = ["Chronological Rank", "Username", "Name", "Recent Timestamp", "Reciprocity", "Post Count", "Followers"];
    const rows = filteredAccounts.map((a) => [
      `#${a.chronologicalRank + 1}`,
      `@${a.username}`,
      `"${a.name.replace(/"/g, '""')}"`,
      `"${a.timestampLabel}"`,
      `"${a.reciprocityLabel}"`,
      a.postCount,
      a.followersCount,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `ghostsweep_${auditData.username}_${selectedTargetType}_activity.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="results-card" className="max-w-2xl mx-auto px-4 sm:px-6 pb-12 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Main Forensic Results Card */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-sm mb-4">
        {/* 1. Target Profile Header Row */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-zinc-100 dark:border-zinc-800/80">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={auditData.avatar || auditData.profile_pic_url}
              alt={auditData.username}
              className="w-12 h-12 rounded-2xl object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(auditData.username)}&background=0284c7&color=fff`;
              }}
            />
            <div className="text-left min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 font-bold text-zinc-900 dark:text-white text-sm sm:text-base">
                <span className="truncate">@{auditData.username}</span>
                {auditData.isVerified && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-400 font-semibold">
                    ✓
                  </span>
                )}
                {isUnlocked && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 font-bold">
                    <CheckCircle className="w-2.5 h-2.5" />
                    <span>Unlocked</span>
                  </span>
                )}
                {auditData.isLiveRealData && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 font-bold">
                    <Zap className="w-2.5 h-2.5 fill-emerald-500" />
                    <span>Live Scan</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                {auditData.fullName || auditData.full_name} {auditData.bio || auditData.biography ? `• "${auditData.bio || auditData.biography}"` : ""}
              </p>
              <div className="flex items-center gap-3 text-[11px] text-zinc-400 dark:text-zinc-500 font-medium mt-1">
                <span><strong>{formatNumber(auditData.followers || auditData.follower_count)}</strong> followers</span>
                <span>•</span>
                <span><strong>{formatNumber(auditData.following || auditData.following_count)}</strong> following</span>
                <span>•</span>
                <span><strong>{auditData.ratio}x</strong> ratio</span>
              </div>
            </div>
          </div>

          <div className={`px-2.5 py-1 rounded-md text-[10px] font-bold border uppercase tracking-wide shrink-0 ${scoreBadge.bgColor} ${scoreBadge.textColor}`}>
            {scoreBadge.label}
          </div>
        </div>

        {/* 2. Auditing Switcher Tab Bar: [ 👀 Recent Follows ] | [ 👥 Recent Followers ] */}
        <div className="flex items-center justify-center p-1 bg-zinc-100 dark:bg-zinc-800/70 rounded-xl max-w-md mx-auto my-4 border border-zinc-200 dark:border-zinc-700/60 text-xs font-bold shadow-xs">
          <button
            type="button"
            id="target-toggle-following"
            onClick={() => setSelectedTargetType("following")}
            className={`flex-1 py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              selectedTargetType === "following"
                ? "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white shadow-sm border border-zinc-200/80 dark:border-zinc-700 font-extrabold"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-sky-400" />
            <span>
              Recent Follows {isUnlocked ? `(${formatNumber(auditData.following || auditData.following_count)})` : "(Top 5)"}
            </span>
          </button>
          <button
            type="button"
            id="target-toggle-followers"
            onClick={() => setSelectedTargetType("followers")}
            className={`flex-1 py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              selectedTargetType === "followers"
                ? "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white shadow-sm border border-zinc-200/80 dark:border-zinc-700 font-extrabold"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <Users className="w-3.5 h-3.5 text-pink-400" />
            <span>
              Recent Followers {isUnlocked ? `(${formatNumber(auditData.followers || auditData.follower_count)})` : "(Top 5)"}
            </span>
          </button>
        </div>

        {/* 3. Follow Activity Header */}
        <div className="flex items-center justify-between gap-2 mb-3 pt-2">
          <div className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-200 font-bold">
            <span>⚡ Audited {selectedTargetType === "followers" ? "Followers" : "Following"} Activity {isUnlocked ? `(${allAccounts.length} accounts)` : "(Top 5 Preview)"}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowBreakdown((prev) => !prev)}
            className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <span>{showBreakdown ? "Hide List" : "Inspect List"}</span>
            {showBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* 4. Account Activity List & Paywall */}
        {showBreakdown && (
          <div id="inspect-drawer" className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 animate-in fade-in">
            {!isUnlocked ? (
              /* FREE STATE: Account #1 Clear, Accounts #2-5 Blurred, and Psychological Curiosity Box */
              <>
                <div className="space-y-2 mb-4">
                  {previewAccounts.map((acc, index) => {
                    const isFirst = index === 0;

                    if (isFirst) {
                      // ACCOUNT #1: 100% Clear & Real Proof
                      return (
                        <div
                          key={acc.id || `preview-${index}`}
                          className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800/80 text-xs gap-2 shadow-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <img
                              src={acc.avatar}
                              alt={acc.username}
                              className="w-10 h-10 rounded-xl object-cover border border-sky-300 dark:border-sky-700 shrink-0"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(acc.username)}&background=0284c7&color=fff`;
                              }}
                            />
                            <div className="text-left min-w-0">
                              <div className="font-bold text-zinc-900 dark:text-white flex items-center gap-1.5 truncate">
                                <span className="truncate">@{acc.username}</span>
                                {acc.isVerified && (
                                  <span className="text-[10px] px-1 py-0.2 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-400 font-semibold">
                                    ✓
                                  </span>
                                )}
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-bold shrink-0 font-mono ${
                                  acc.isNewFollow 
                                    ? "bg-emerald-100 dark:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300"
                                    : "bg-sky-100 dark:bg-sky-900/80 text-sky-700 dark:text-sky-300"
                                }`}>
                                  {acc.isNewFollow ? "⚡ NEW FOLLOW" : "AUDITED FOLLOWING"}
                                </span>
                              </div>
                              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate block">
                                {acc.name || "Active Account"} &bull; {acc.followsYou ? "🔄 Follows Back" : "🚫 Doesn't Follow Back"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-start sm:self-auto">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                              acc.isNewFollow
                                ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                                : "bg-sky-100 dark:bg-sky-950/80 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800"
                            }`}>
                              {acc.isNewFollow ? "NEW DETECTED" : "LIVE FOLLOW"}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {acc.timestampLabel || "Audited Follow"}
                            </span>
                          </div>
                        </div>
                      );
                    }

                    // ACCOUNTS #2 - #5: BLURRED TEASER
                    return (
                      <div
                        key={acc.id || `preview-${index}`}
                        className="relative flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-zinc-50/80 dark:bg-zinc-850/40 border border-zinc-200/80 dark:border-zinc-800/80 text-xs gap-2 overflow-hidden select-none pointer-events-none"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 filter blur-[5px] opacity-70">
                          <div className="w-9 h-9 rounded-xl bg-zinc-300 dark:bg-zinc-700 shrink-0" />
                          <div className="text-left min-w-0">
                            <div className="font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                              <span>@{acc.username ? `${acc.username.slice(0, 2)}•••••••••` : "user••••••"}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded-md font-semibold bg-zinc-200 dark:bg-zinc-750 text-zinc-700 dark:text-zinc-300 font-mono">
                                #{index + 1}
                              </span>
                            </div>
                            <span className="text-[11px] text-zinc-400 block">
                              •••••••• ••••••••
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 filter blur-[2px] opacity-70 self-start sm:self-auto">
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                            HIDDEN FOLLOW #{index + 1}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* High-Converting Emotional Curiosity Box & $3.99 Unlock */}
                <div className="relative rounded-2xl overflow-hidden border border-rose-200/80 dark:border-rose-900/60 bg-gradient-to-b from-rose-50/40 via-white to-zinc-50 dark:from-rose-950/20 dark:via-zinc-900 dark:to-zinc-900 p-6 text-center shadow-lg mt-3">
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-bold">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                      <span>Who Did They Follow Last Night?</span>
                    </div>

                    <div className="text-base sm:text-lg font-black text-zinc-900 dark:text-white leading-snug max-w-md">
                      Unlock to See the Truth
                    </div>

                    <p className="text-xs text-zinc-600 dark:text-zinc-300 max-w-md">
                      Reveal who <strong className="text-zinc-900 dark:text-white">@{auditData.username}</strong> recently followed, hidden activity, and mutual connections in exact chronological order.
                    </p>

                    {/* Emotional Curiosity Bullets */}
                    <div className="w-full max-w-sm text-left bg-white/80 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/80 rounded-xl p-3 space-y-2 text-xs text-zinc-700 dark:text-zinc-300 shadow-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-rose-500 font-bold">🚨</span>
                        <span><b>Recent follows hidden &amp; scrambled</b> by Instagram app</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-amber-500 font-bold">⚠️</span>
                        <span><b>New late-night follows</b> flagged with exact rank</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sky-500 font-bold">🔄</span>
                        <span><b>Unmask non-reciprocals</b> (they follow but aren't followed back)</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      id="unlock-list-cta-btn"
                      onClick={onOpenCheckout}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 py-3.5 px-8 rounded-xl font-black text-xs sm:text-sm text-zinc-950 bg-gradient-to-r from-sky-400 via-cyan-300 to-sky-400 hover:from-cyan-300 hover:to-sky-400 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg mt-1 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Unlock to See the Truth ($3.99) ➔</span>
                    </button>

                    <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-zinc-400 dark:text-zinc-500 pt-1 font-medium">
                      <span>✓ One-Time Fee ($3.99)</span>
                      <span>&bull;</span>
                      <span>✓ 10 Deep Searches / Week</span>
                      <span>&bull;</span>
                      <span>✓ 100% Anonymous</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* PAID UNLOCKED STATE: Full Searchable Chronological Table */
              <div className="space-y-3">
                {/* Diff Radar Snapshot Alert */}
                {auditData.diffSummary && auditData.diffSummary.newFollowsCount > 0 ? (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between animate-in fade-in">
                    <span className="font-bold flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-emerald-500 fill-emerald-500" />
                      <span>{auditData.diffSummary.newFollowsCount} New Follow(s) Detected Since Last Scan!</span>
                    </span>
                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded font-mono font-bold">
                      Diff Radar Active
                    </span>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60 text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
                    <span>🛡️ <strong>Baseline Snapshot Active:</strong> {allAccounts.length} follows indexed</span>
                    <span className="text-[10px] text-zinc-400">Re-scans will automatically flag new follows</span>
                  </div>
                )}

                {/* Search Bar & Export Controls */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search handles or names..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-sky-500" />
                    <span>Download Report / CSV</span>
                  </button>
                </div>

                {/* Full Chronological Activity List */}
                <div className="max-h-96 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {filteredAccounts.length === 0 ? (
                    <div className="p-6 text-center text-xs text-zinc-400">
                      No accounts found matching your search.
                    </div>
                  ) : (
                    filteredAccounts.map((acc) => (
                      <div
                        key={acc.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-white dark:bg-zinc-900/60 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 text-xs transition-colors gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-[10px] font-mono font-bold text-zinc-400 w-6 text-center shrink-0">
                            #{acc.chronologicalRank + 1}
                          </span>
                          <img
                            src={acc.avatar}
                            alt={acc.username}
                            className="w-8 h-8 rounded-xl object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(acc.username)}&background=0284c7&color=fff`;
                            }}
                          />
                          <div className="text-left min-w-0">
                            <div className="font-bold text-zinc-900 dark:text-white flex items-center gap-1.5 truncate">
                              <span className="truncate">@{acc.username}</span>
                              {acc.isVerified && (
                                <span className="text-[10px] px-1 py-0.2 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-600 dark:text-sky-400 font-semibold">
                                  ✓
                                </span>
                              )}
                              {acc.isNewFollow && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-mono">
                                  ⚡ NEW
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-zinc-400 truncate block">
                              {acc.name}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 flex items-center gap-1">
                            <span>{acc.timestampLabel}</span>
                          </span>

                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            acc.followsYou
                              ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60"
                              : "bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60"
                          }`}>
                            {acc.reciprocityLabel}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trust & Instant Access Banner */}
      {!isUnlocked && (
        <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-zinc-500 font-medium my-2">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>100% Anonymous Search</span>
          </span>
          <span>•</span>
          <span>Zero Passwords Required</span>
          <span>•</span>
          <span className="text-sky-400 font-semibold">$3.99 One-Time Access</span>
        </div>
      )}
    </div>
  );
};

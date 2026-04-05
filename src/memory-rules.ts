export interface DiaryWindowSelection {
  currentWeekDailyPaths: string[];
  currentMonthWeeklyPaths: string[];
  previousMonthlyPaths: string[];
}

type DiaryFileKind = "daily" | "weekly" | "monthly" | "other";

interface DiaryFileInfo {
  path: string;
  kind: DiaryFileKind;
  sortValue: number;
  date?: Date;
  rangeStart?: Date;
  rangeEnd?: Date;
  monthIndex?: number;
}

const MEMORY_INTENT_PATTERNS = [
  /记得|还记得|回忆|回想|想起|复盘|总结|根据记忆|结合记忆|从记忆里/i,
  /日记|周报|月报|近况|状态|情绪|最近|之前|上周|这周|这个月|前几天|前阵子/i,
  /我的习惯|我的偏好|我最近|我这周|我上周|我之前|我是不是/i,
];

const DAILY_BASENAME = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKLY_BASENAME = /^(\d{4})-W(\d{2})$/i;
const MONTHLY_BASENAME = /^(\d{4})-(\d{2})(?:月报|-月报|_月报| monthly report)?$/i;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const fileName = normalized.split("/").pop() ?? normalized;
  return fileName.replace(/\.[^.]+$/, "");
}

function toMonthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function startOfIsoWeek(date: Date): Date {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfIsoWeek(date: Date): Date {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function isoWeekRange(year: number, week: number): { start: Date; end: Date } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstWeekStart = startOfIsoWeek(jan4);
  const start = new Date(firstWeekStart);
  start.setUTCDate(start.getUTCDate() + (week - 1) * 7);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function parseDiaryFile(path: string): DiaryFileInfo {
  const name = basename(path);
  const daily = DAILY_BASENAME.exec(name);
  if (daily) {
    const [, year, month, day] = daily;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return {
      path,
      kind: "daily",
      date,
      sortValue: date.getTime(),
    };
  }

  const weekly = WEEKLY_BASENAME.exec(name);
  if (weekly) {
    const [, year, week] = weekly;
    const range = isoWeekRange(Number(year), Number(week));
    return {
      path,
      kind: "weekly",
      rangeStart: range.start,
      rangeEnd: range.end,
      sortValue: range.start.getTime(),
    };
  }

  const monthly = MONTHLY_BASENAME.exec(name);
  if (monthly) {
    const [, year, month] = monthly;
    return {
      path,
      kind: "monthly",
      monthIndex: Number(year) * 12 + (Number(month) - 1),
      sortValue: Number(year) * 100 + Number(month),
    };
  }

  return {
    path,
    kind: "other",
    sortValue: Number.MAX_SAFE_INTEGER,
  };
}

function intersectsMonth(start: Date, end: Date, now: Date): boolean {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return start < nextMonthStart && end >= currentMonthStart;
}

export function isMemoryRelevant(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) {
    return false;
  }

  return MEMORY_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function selectDiaryWindow(paths: string[], now: Date): DiaryWindowSelection {
  const normalizedNow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const weekStart = startOfIsoWeek(normalizedNow);
  const weekEnd = endOfIsoWeek(normalizedNow);
  const currentMonthIndex = toMonthIndex(normalizedNow);

  const files = paths.map((path) => parseDiaryFile(path));

  return {
    currentWeekDailyPaths: files
      .filter((file) => file.kind === "daily" && file.date && file.date >= weekStart && file.date <= weekEnd)
      .sort((left, right) => left.sortValue - right.sortValue)
      .map((file) => file.path),
    currentMonthWeeklyPaths: files
      .filter(
        (file) =>
          file.kind === "weekly" &&
          file.rangeStart &&
          file.rangeEnd &&
          intersectsMonth(file.rangeStart, file.rangeEnd, normalizedNow),
      )
      .sort((left, right) => left.sortValue - right.sortValue)
      .map((file) => file.path),
    previousMonthlyPaths: files
      .filter((file) => file.kind === "monthly" && typeof file.monthIndex === "number" && file.monthIndex < currentMonthIndex)
      .sort((left, right) => right.sortValue - left.sortValue)
      .map((file) => file.path),
  };
}

/**
 * League Gothic, measured in Chrome (`scripts/design/lg-metrics.mts`). Units are em. Generated: do
 * not edit by hand. The server passes the values the day needs as inline CSS variables
 * (`--month-adv`, `--day-ink`, `--day-lsb`, `--day-rsb`), so the hero is fitted by CSS alone.
 */

/** Digit height (ink ascent of the figures; the caps are a hair shorter). */
export const LG_CAP = 0.743;
/** The face's ascent and descent (hhea), for placing a baseline inside a line box. */
export const LG_ASCENT = 0.967;
export const LG_DESCENT = 0.232;

/** Advance width of each month, uppercase. */
export const MONTH_ADVANCE: Readonly<Record<string, number>> = {
  JANUARY: 2.468,
  FEBRUARY: 2.821,
  MARCH: 1.968,
  APRIL: 1.581,
  MAY: 1.206,
  JUNE: 1.302,
  JULY: 1.213,
  AUGUST: 2.158,
  SEPTEMBER: 3.208,
  OCTOBER: 2.454,
  NOVEMBER: 2.974,
  DECEMBER: 2.916,
};

/** Ink width of each day numeral. */
export const DAY_INK: Readonly<Record<string, number>> = {
  "1": 0.18,
  "2": 0.293,
  "3": 0.292,
  "4": 0.316,
  "5": 0.282,
  "6": 0.282,
  "7": 0.272,
  "8": 0.288,
  "9": 0.282,
  "10": 0.541,
  "11": 0.42,
  "12": 0.548,
  "13": 0.542,
  "14": 0.5535,
  "15": 0.532,
  "16": 0.532,
  "17": 0.5095,
  "18": 0.534,
  "19": 0.532,
  "20": 0.649,
  "21": 0.528,
  "22": 0.656,
  "23": 0.65,
  "24": 0.6615,
  "25": 0.64,
  "26": 0.64,
  "27": 0.6175,
  "28": 0.642,
  "29": 0.64,
  "30": 0.643,
  "31": 0.522,
};

/** Left side bearing of each day numeral (ink starts this far right of the pen). */
export const DAY_LSB: Readonly<Record<string, number>> = {
  "1": 0.02,
  "2": 0.035,
  "3": 0.03,
  "4": 0.0175,
  "5": 0.03,
  "6": 0.03,
  "7": 0.0175,
  "8": 0.026,
  "9": 0.03,
  "10": 0.02,
  "11": 0.02,
  "12": 0.02,
  "13": 0.02,
  "14": 0.02,
  "15": 0.02,
  "16": 0.02,
  "17": 0.02,
  "18": 0.02,
  "19": 0.02,
  "20": 0.035,
  "21": 0.035,
  "22": 0.035,
  "23": 0.035,
  "24": 0.035,
  "25": 0.035,
  "26": 0.035,
  "27": 0.035,
  "28": 0.035,
  "29": 0.035,
  "30": 0.03,
  "31": 0.03,
};

/** Right side bearing of each day numeral (ink ends this far left of the advance). */
export const DAY_RSB: Readonly<Record<string, number>> = {
  "1": 0.04,
  "2": 0.035,
  "3": 0.03,
  "4": 0.0175,
  "5": 0.03,
  "6": 0.03,
  "7": 0.0175,
  "8": 0.026,
  "9": 0.03,
  "10": 0.033,
  "11": 0.04,
  "12": 0.035,
  "13": 0.03,
  "14": 0.0175,
  "15": 0.03,
  "16": 0.03,
  "17": 0.0175,
  "18": 0.026,
  "19": 0.03,
  "20": 0.033,
  "21": 0.04,
  "22": 0.035,
  "23": 0.03,
  "24": 0.0175,
  "25": 0.03,
  "26": 0.03,
  "27": 0.0175,
  "28": 0.026,
  "29": 0.03,
  "30": 0.033,
  "31": 0.04,
};

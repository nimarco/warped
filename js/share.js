/*
 * share.js — BROWSER API: Clipboard API
 * https://developer.mozilla.org/docs/Web/API/Clipboard_API
 *
 * Builds the spoiler-free emoji result and copies it. If the clipboard is
 * blocked, copyText returns false and the page shows the text to copy by hand.
 */

const RESULT_EMOJI = {
  correct: "🟩",
  artist: "🟨",
  title: "🟨",
  wrong: "🟥",
  skip: "⬛",
};

const PEEK_EMOJI = "👁️";

/**
 * @param {object} options
 * @param {number} options.puzzleNumber
 * @param {{ guesses: { result: string }[], peeks: number }[]} options.rounds
 * @param {number} options.total
 * @param {number} options.streak
 */
export function buildShareText({ puzzleNumber, rounds, total, streak }) {
  const lines = rounds.map((round, index) => {
    const tries = round.guesses.map((guess) => RESULT_EMOJI[guess.result]).join("");
    const peeks = PEEK_EMOJI.repeat(round.peeks);
    return `${index + 1} ${tries}${peeks}`;
  });

  const streakLine = streak > 1 ? `\n🔥 ${streak}-day streak` : "";
  const url = `${window.location.origin}${window.location.pathname}`;

  return `WARPED #${puzzleNumber} · ${total}/1000${streakLine}\n${lines.join("\n")}\n${url}`;
}

/** Copy text to the clipboard. Resolves true on success, false if blocked. */
export async function copyText(text) {
  if (!navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

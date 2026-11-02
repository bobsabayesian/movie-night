export type RoundOutcome = 'pending' | 'won' | 'nobody' | 'abandoned';

export type Status = 'lobby' | 'generating' | 'acting' | 'scoring';

export interface ScriptLine {
  speaker: string;
  line: string;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isAdmin: boolean;
  /** hex from config.json colors; unique per lobby, chosen at join */
  color: string;
}

export interface Candidate {
  title: string;
  description: string;
}

export type Difficulty = 'easy' | 'hard';

export interface PromptData {
  scene: string;
  style: string;
  difficulty: Difficulty;
  genre: string;
  /** number of speaking parts requested */
  parts: number;
  chosen?: Candidate;
}

/** Everything clients may see. Secrets (player tokens) live outside this. */
export interface GameState {
  session_id: string;
  status: Status;
  players: Player[];
  /** null until the admin starts the game. */
  prompterId: string | null;
  /** Set while the LLM found several matching scenes and the prompter must choose. */
  candidates: Candidate[] | null;
  promptData: PromptData | null;
  current_script: ScriptLine[];
  /** speaker (character) -> player id */
  roles: Record<string, string>;
  rolesAssigned: boolean;
  error: string | null;
  ended: boolean;
  /** Host can switch these off for this session; the full lists live in config.json. */
  disabledStyles: string[];
  disabledGenres: string[];
  /** 1-based number of the current/last round */
  roundNo: number;
}

export type ClientMessage =
  | { type: 'join'; name: string; color?: string; token?: string }
  | { type: 'start'; prompterId: string }
  | { type: 'submitPrompt'; scene: string; style: string; difficulty: Difficulty; genre: string; parts: number }
  | { type: 'pickCandidate'; index: number }
  | { type: 'assignRoles'; roles: Record<string, string> }
  | { type: 'finishActing' }
  | { type: 'awardPoint'; playerId: string }
  | { type: 'skipRound'; nextPrompterId: string }
  | { type: 'setEnabled'; kind: 'style' | 'genre'; value: string; enabled: boolean }
  | { type: 'kick'; playerId: string }
  | { type: 'setPrompter'; playerId: string }
  | { type: 'terminate' };

export type ServerMessage =
  | { type: 'joined'; playerId: string; token: string }
  | { type: 'state'; state: GameState }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'kicked' };

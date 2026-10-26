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
}

export interface Candidate {
  title: string;
  description: string;
}

export interface PromptData {
  scene: string;
  style: string;
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
}

export type ClientMessage =
  | { type: 'join'; name: string; token?: string }
  | { type: 'start'; prompterId: string }
  | { type: 'submitPrompt'; scene: string; style: string }
  | { type: 'pickCandidate'; index: number }
  | { type: 'assignRoles'; roles: Record<string, string> }
  | { type: 'finishActing' }
  | { type: 'awardPoint'; playerId: string }
  | { type: 'kick'; playerId: string }
  | { type: 'setPrompter'; playerId: string }
  | { type: 'terminate' };

export type ServerMessage =
  | { type: 'joined'; playerId: string; token: string }
  | { type: 'state'; state: GameState }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'kicked' };

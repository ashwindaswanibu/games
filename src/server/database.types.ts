/**
 * Database types in the shape `supabase gen types typescript` emits, verified against the
 * generated output. Deliberately tighter where the generator can't infer: `plays.status` and
 * `puzzle_assets.mime` are the CHECK-constrained unions; `leaderboard().avg_score`,
 * `search_films().year`, `search_films().aka` and `search_people().known_for` are nullable;
 * `movie_film_titles.kind` is its CHECK-constrained union; generated `search_key`, `compact_key`
 * and `fame` columns are never null (the values they derive from are NOT NULL), while
 * `movie_film_titles.number_key` is null unless a name has sequel numbering, and `split_key` (titles
 * and people) unless a name has an apostrophe inside a word;
 * `catalog_match_class()` and `catalog_name_match_class()` return null for no match;
 * `replace_unplayed_puzzle()` returns one of its four outcomes.
 * After a migration, run `npm run db:types` and diff against this file.
 */

import type { AssetMime } from "@/core/assets";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.5";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          is_admin: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          is_admin?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string;
          is_admin?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      puzzles: {
        Row: {
          game_id: string;
          puzzle_date: string;
          payload: Json;
          solution: Json;
          created_at: string;
        };
        Insert: {
          game_id: string;
          puzzle_date: string;
          payload: Json;
          solution: Json;
          created_at?: string;
        };
        Update: {
          game_id?: string;
          puzzle_date?: string;
          payload?: Json;
          solution?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      plays: {
        Row: {
          user_id: string;
          game_id: string;
          puzzle_date: string;
          state: Json;
          status: "in_progress" | "won" | "lost";
          score: number | null;
          result_label: string | null;
          share_grid: string | null;
          version: number;
          started_at: string;
          finished_at: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          game_id: string;
          puzzle_date: string;
          state: Json;
          status?: "in_progress" | "won" | "lost";
          score?: number | null;
          result_label?: string | null;
          share_grid?: string | null;
          version?: number;
          started_at?: string;
          finished_at?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          game_id?: string;
          puzzle_date?: string;
          state?: Json;
          status?: "in_progress" | "won" | "lost";
          score?: number | null;
          result_label?: string | null;
          share_grid?: string | null;
          version?: number;
          started_at?: string;
          finished_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plays_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plays_game_id_puzzle_date_fkey";
            columns: ["game_id", "puzzle_date"];
            isOneToOne: false;
            referencedRelation: "puzzles";
            referencedColumns: ["game_id", "puzzle_date"];
          },
        ];
      };
      puzzle_assets: {
        Row: {
          id: string;
          game_id: string;
          puzzle_date: string;
          kind: string;
          mime: AssetMime;
          width: number;
          height: number;
          /** bytea, as PostgREST's hex text form: "\\x89504e47…". */
          bytes: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          puzzle_date: string;
          kind: string;
          mime: AssetMime;
          width: number;
          height: number;
          bytes: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          game_id?: string;
          puzzle_date?: string;
          kind?: string;
          mime?: AssetMime;
          width?: number;
          height?: number;
          bytes?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "puzzle_assets_game_id_puzzle_date_fkey";
            columns: ["game_id", "puzzle_date"];
            isOneToOne: false;
            referencedRelation: "puzzles";
            referencedColumns: ["game_id", "puzzle_date"];
          },
        ];
      };
      movie_films: {
        Row: {
          id: number;
          title: string;
          year: number | null;
          genres: string[];
          directors: string[];
          popularity: number;
          imdb_votes: number | null;
          fame: number;
          /** Wikidata ids of the film series it is part of (see scripts/content/movies/lib/catalog-model.mts, `seriesOfFilm`). */
          series_qids: string[];
          /** IMDb lists the title as adult: hidden from search and never chosen by a content pipeline. */
          is_adult: boolean;
          tmdb_id: number | null;
          imdb_id: string | null;
          wikidata_id: string | null;
          search_key: string;
        };
        Insert: {
          id?: number;
          title: string;
          year?: number | null;
          genres?: string[];
          directors?: string[];
          popularity?: number;
          imdb_votes?: number | null;
          fame?: never;
          series_qids?: string[];
          is_adult?: boolean;
          tmdb_id?: number | null;
          imdb_id?: string | null;
          wikidata_id?: string | null;
          search_key?: never;
        };
        Update: {
          id?: number;
          title?: string;
          year?: number | null;
          genres?: string[];
          directors?: string[];
          popularity?: number;
          imdb_votes?: number | null;
          fame?: never;
          series_qids?: string[];
          is_adult?: boolean;
          tmdb_id?: number | null;
          imdb_id?: string | null;
          wikidata_id?: string | null;
          search_key?: never;
        };
        Relationships: [];
      };
      movie_film_titles: {
        Row: {
          film_id: number;
          title: string;
          kind: MovieFilmTitleKind;
          fame: number;
          search_key: string;
          compact_key: string;
          number_key: string | null;
          split_key: string | null;
        };
        Insert: {
          film_id: number;
          title: string;
          kind: MovieFilmTitleKind;
          fame?: number;
          search_key?: never;
          compact_key?: never;
          number_key?: never;
          split_key?: never;
        };
        Update: {
          film_id?: number;
          title?: string;
          kind?: MovieFilmTitleKind;
          fame?: number;
          search_key?: never;
          compact_key?: never;
          number_key?: never;
          split_key?: never;
        };
        Relationships: [
          {
            foreignKeyName: "movie_film_titles_film_id_fkey";
            columns: ["film_id"];
            isOneToOne: false;
            referencedRelation: "movie_films";
            referencedColumns: ["id"];
          },
        ];
      };
      movie_people: {
        Row: {
          id: number;
          name: string;
          popularity: number;
          wikidata_id: string | null;
          imdb_id: string | null;
          is_actor: boolean;
          is_human: boolean | null;
          search_key: string;
          compact_key: string;
          split_key: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          popularity?: number;
          wikidata_id?: string | null;
          imdb_id?: string | null;
          is_actor?: boolean;
          is_human?: boolean | null;
          search_key?: never;
          compact_key?: never;
          split_key?: never;
        };
        Update: {
          id?: number;
          name?: string;
          popularity?: number;
          wikidata_id?: string | null;
          imdb_id?: string | null;
          is_actor?: boolean;
          is_human?: boolean | null;
          search_key?: never;
          compact_key?: never;
          split_key?: never;
        };
        Relationships: [];
      };
      movie_credits: {
        Row: {
          film_id: number;
          person_id: number;
          billing: number | null;
        };
        Insert: {
          film_id: number;
          person_id: number;
          billing?: number | null;
        };
        Update: {
          film_id?: number;
          person_id?: number;
          billing?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "movie_credits_film_id_fkey";
            columns: ["film_id"];
            isOneToOne: false;
            referencedRelation: "movie_films";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "movie_credits_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "movie_people";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: { key: string; window_start: string; hits: number };
        Insert: { key: string; window_start: string; hits: number };
        Update: { key?: string; window_start?: string; hits?: number };
        Relationships: [];
      };
      password_change_grants: {
        Row: { user_id: string; expires_at: string };
        Insert: { user_id: string; expires_at: string };
        Update: { user_id?: string; expires_at?: string };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      leaderboard: {
        Args: { p_from: string; p_to: string; p_game_ids: string[]; p_viewer: string; p_today: string };
        Returns: {
          user_id: string;
          username: string;
          display_name: string;
          points: number;
          games_played: number;
          wins: number;
          avg_score: number | null;
          rank: number;
        }[];
      };
      streaks: {
        Args: { p_today: string; p_game_ids: string[] };
        Returns: {
          user_id: string;
          current_streak: number;
          best_streak: number;
        }[];
      };
      catalog_search_key: {
        Args: { value: string };
        Returns: string;
      };
      catalog_split_key: {
        Args: { value: string };
        Returns: string;
      };
      catalog_film_index: {
        Args: { p_part: number; p_parts: number };
        Returns: string;
      };
      catalog_number_key: {
        Args: { key: string };
        Returns: string;
      };
      catalog_match_class: {
        Args: { name_key: string; query_key: string };
        Returns: number | null;
      };
      catalog_name_match_class: {
        Args: { name_key: string; name_split: string; query_key: string; query_split: string };
        Returns: number | null;
      };
      search_films: {
        Args: { p_query: string; p_limit?: number; p_person?: number };
        Returns: {
          id: number;
          title: string;
          year: number | null;
          directors: string[];
          fame: number;
          aka: string | null;
        }[];
      };
      search_people: {
        Args: { p_query: string; p_limit?: number };
        Returns: {
          id: number;
          name: string;
          popularity: number;
          known_for: string | null;
        }[];
      };
      replace_unplayed_puzzle: {
        Args: { p_game_id: string; p_date: string; p_expected_payload: Json; p_payload: Json; p_solution: Json };
        Returns: ReplaceUnplayedPuzzleOutcome;
      };
      degrees_next_link: {
        Args: { p_from: number; p_to: number; p_avoid: number[]; p_max_links: number };
        Returns: {
          film_id: number;
          person_id: number;
          links: number;
        }[];
      };
      orphan_auth_user_for_email: {
        Args: { p_email: string };
        Returns: {
          id: string;
          created_at: string;
        }[];
      };
      allow_password_change: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      password_hash_scheme: {
        Args: { p_hash: string };
        Returns: string;
      };
      take_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      text_array_ok: {
        Args: { items: string[]; max_length: number };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type PlayRow = Database["public"]["Tables"]["plays"]["Row"];
export type PuzzleAssetRow = Database["public"]["Tables"]["puzzle_assets"]["Row"];
export type MovieFilmRow = Database["public"]["Tables"]["movie_films"]["Row"];
export type MoviePersonRow = Database["public"]["Tables"]["movie_people"]["Row"];
export type MovieCreditRow = Database["public"]["Tables"]["movie_credits"]["Row"];
export type MovieFilmTitleRow = Database["public"]["Tables"]["movie_film_titles"]["Row"];

/** `movie_film_titles.kind`: the display title, IMDb's titles, Wikidata/Wikipedia names, or a former display title. */
export type MovieFilmTitleKind = "display" | "original" | "alias" | "former";

/** `replace_unplayed_puzzle()`: done, or why not (no puzzle; someone has played it; rewritten since it was read). */
export type ReplaceUnplayedPuzzleOutcome = "replaced" | "missing" | "played" | "changed";

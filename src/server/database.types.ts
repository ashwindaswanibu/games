/**
 * Database types in the shape `supabase gen types typescript` emits, verified against the
 * generated output. Deliberately tighter where the generator can't infer: `plays.status` and
 * `puzzle_assets.mime` are the CHECK-constrained unions; `leaderboard().avg_score`,
 * `search_films().year` and `search_people().known_for` are nullable; generated `search_key`
 * columns are never null (the title/name they derive from is NOT NULL).
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
          tmdb_id?: number | null;
          imdb_id?: string | null;
          wikidata_id?: string | null;
          search_key?: never;
        };
        Relationships: [];
      };
      movie_people: {
        Row: {
          id: number;
          name: string;
          popularity: number;
          wikidata_id: string | null;
          search_key: string;
        };
        Insert: {
          id?: number;
          name: string;
          popularity?: number;
          wikidata_id?: string | null;
          search_key?: never;
        };
        Update: {
          id?: number;
          name?: string;
          popularity?: number;
          wikidata_id?: string | null;
          search_key?: never;
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
      search_films: {
        Args: { p_query: string; p_limit?: number };
        Returns: {
          id: number;
          title: string;
          year: number | null;
          directors: string[];
          popularity: number;
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

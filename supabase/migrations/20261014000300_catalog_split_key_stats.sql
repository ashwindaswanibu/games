-- Statistics for the split search keys added by 20261014000200. Without them the planner walks
-- movie_people by popularity and filters every row for the split-key tier (~40 ms for "sam" instead
-- of ~13 ms); autoanalyze would only catch up much later.
analyze public.movie_film_titles (split_key);
analyze public.movie_people (split_key);

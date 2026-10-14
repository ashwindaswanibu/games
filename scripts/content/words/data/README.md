# Lexicon word data

Built by `../lexicon-data.mts` from two free sources (see its header to rebuild):

- **`lexicon-words.txt`**: every word a Lexicon guess may be (3–9 letters, lower case), from
  12dicts' `3of6game.txt`, a list made for word games.
- **`lexicon-answers.tsv`**: the words a day's answer may be, `word<TAB>part of speech<TAB>definition`:
  common headwords (12dicts' `2+2+3frq.txt`, frequency groups 1–12), 5–7 letters, with the first
  sense of their commonest part of speech from WordNet 3.1, minus words WordNet marks vulgar,
  obscene, a slur or disparaging, and a short blocklist.

Built by `../lexicon-seed-data.mts` from WordNet's tagged-corpus counts and the guess list:

- **`lexicon-seeds.txt`**: the common nine-letter words a day's letters may be (used 3+ times in
  WordNet's tagged corpus).
- **`lexicon-seed-parts.txt`**: the common 3–6-letter words, two of which may make a day's nine
  (used 10+ times, or marked rude; senses marked as slurs don't count).

## 12dicts

The 12dicts lists were compiled by Alan Beale, who released them to the public domain and asks for
acknowledgment of their use: thank you. Version 6.0.2, from http://wordlist.aspell.net/12dicts/.
The inflected lists depend on AGID, under this notice:

    Copyright 2000 by Kevin Atkinson

    Permission to use, copy, modify, distribute and sell this database, the associated scripts, the
    output created form the scripts and its documentation for any purpose is hereby granted without
    fee, provided that the above copyright notice appears in all copies and that both that copyright
    notice and this permission notice appear in supporting documentation. Kevin Atkinson makes no
    representations about the suitability of this array for any purpose. It is provided "as is"
    without express or implied warranty.

## WordNet 3.1

Definitions are from WordNet 3.1 (https://wordnet.princeton.edu/), under its license:

    This software and database is being provided to you, the LICENSEE, by
    Princeton University under the following license.  By obtaining, using
    and/or copying this software and database, you agree that you have
    read, understood, and will comply with these terms and conditions.:
    
    Permission to use, copy, modify and distribute this software and
    database and its documentation for any purpose and without fee or
    royalty is hereby granted, provided that you agree to comply with
    the following copyright notice and statements, including the disclaimer,
    and that the same appear on ALL copies of the software, database and
    documentation, including modifications that you make for internal
    use or for distribution.
    
    WordNet 3.1 Copyright 2011 by Princeton University.  All rights reserved.
    
    THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON
    UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
    IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON
    UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-
    ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE
    OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT
    INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR
    OTHER RIGHTS.
    
    The name of Princeton University or Princeton may not be used in
    advertising or publicity pertaining to distribution of the software
    and/or database.  Title to copyright in this software, database and
    any associated documentation shall at all times remain with
    Princeton University and LICENSEE agrees to preserve same.

# Separate generation, verification evidence, and approval

Status: accepted product direction; enforcement remains to be validated.

TripSit retains Gemma ticket implementation and combines uncertainty-guided investigation with a change-impact graph. Model claims, controlled execution observations, and named-human acceptance are separate records and authorities. A single model verdict cannot substitute for evidence or authorize a merge, because generation and review can share mistakes and be influenced by repository content.

This separation requires revision-bound provenance and an execution boundary without publishing credentials. It adds coordination work compared with author → reviewer → approval, but preserves inspectable reasons for acceptance and exposes missing evidence.

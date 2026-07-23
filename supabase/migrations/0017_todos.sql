-- Personal ToDo list, shown as its own module. Two independent kinds of
-- "done" live on the same row on purpose rather than as two tables:
--   done          -- Dario checked this off himself in the UI.
--   claude_status -- whether this item is (or was) something to hand to
--                    the "tor-dash brief refresh" Claude Routine (see
--                    that Routine's prompt) instead of just a personal
--                    reminder. 'none' items are never touched by the
--                    Routine; flipping needs_claude on sets this to
--                    'requested', which is the only status the Routine
--                    is allowed to pick up and act on. claude_note is
--                    the Routine's own short report back (what it did,
--                    or a question it couldn't resolve on its own),
--                    surfaced in the UI under the item instead of only
--                    in chat.
-- Same owner-only RLS shape as dashboard_settings/sarek_packlist -- this
-- is Dario's list, end to end, not something the gate or anon ever sees.

create table if not exists public.todos (
  id             bigint generated always as identity primary key,
  text           text not null,
  done           boolean not null default false,
  done_at        timestamptz,
  needs_claude   boolean not null default false,
  claude_status  text not null default 'none' check (claude_status in ('none', 'requested', 'done')),
  claude_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.todos enable row level security;

create policy "owner_all_todos" on public.todos
  for all using (public.is_owner()) with check (public.is_owner());

grant select, insert, update, delete on public.todos to authenticated;

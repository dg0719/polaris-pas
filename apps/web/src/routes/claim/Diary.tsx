import { useState } from 'react';
import { request, useMutation } from '../../lib/api.ts';
import { addDaysIso, date, dateTime, relativeDays, todayIso } from '../../lib/format.ts';
import type { ClaimPage } from '../../lib/types.ts';
import {
  Button,
  Empty,
  Field,
  Notice,
  Section,
  Status,
  TextInput,
} from '../../components/ui.tsx';

/** Dated follow-ups plus free-form file notes. */
export function Diary({
  page,
  canWork,
  onChanged,
}: {
  page: ClaimPage;
  canWork: boolean;
  onChanged: () => void;
}) {
  const open = page.claim.status === 'Open';
  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState(addDaysIso(todayIso(), 7));
  const [note, setNote] = useState('');
  const today = todayIso();

  const addTask = useMutation<void, unknown>(() =>
    request(`/claims/${page.claim.id}/tasks`, { method: 'POST', body: { subject, dueDate } }),
  );
  const complete = useMutation<string, unknown>((taskId) =>
    request(`/claims/${page.claim.id}/tasks/${taskId}/complete`, { method: 'POST' }),
  );
  const addNote = useMutation<void, unknown>(() =>
    request(`/claims/${page.claim.id}/notes`, { method: 'POST', body: { body: note } }),
  );

  return (
    <>
      <Section title="Diary" note="Dated follow-ups so nothing on the file goes quiet.">
        {complete.error ? <Notice tone="error">{complete.error.message}</Notice> : null}
        {page.tasks.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Follow-up</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                  {canWork ? <th scope="col" className="num">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {page.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.subject}</td>
                    <td>
                      {date(task.dueDate)}{' '}
                      <span className="dim">({relativeDays(task.dueDate)})</span>
                    </td>
                    <td>
                      <Status
                        value={
                          task.status === 'done'
                            ? 'done'
                            : task.dueDate < today
                              ? 'overdue'
                              : 'open'
                        }
                      />
                    </td>
                    {canWork ? (
                      <td className="num">
                        {task.status === 'open' && open ? (
                          <Button
                            variant="ghost"
                            loading={complete.pending}
                            onClick={async () => {
                              if ((await complete.run(task.id)) !== null) onChanged();
                            }}
                          >
                            Done
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No follow-ups" body="Diary items keep a claim from going quiet." />
        )}

        {canWork && open ? (
          <form
            className="stack"
            style={{ maxWidth: '44rem', marginTop: 'var(--s-6)' }}
            onSubmit={async (event) => {
              event.preventDefault();
              if (subject.trim() === '') return;
              if ((await addTask.run()) !== null) {
                setSubject('');
                onChanged();
              }
            }}
          >
            {addTask.error ? <Notice tone="error">{addTask.error.message}</Notice> : null}
            <div className="form-grid">
              <Field label="Follow-up">
                {(props) => (
                  <TextInput
                    {...props}
                    value={subject}
                    placeholder="Request the police report"
                    onChange={(e) => setSubject(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Due">
                {(props) => (
                  <TextInput
                    {...props}
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="btn-row">
              <Button type="submit" loading={addTask.pending} disabled={subject.trim() === ''}>
                Add to diary
              </Button>
            </div>
          </form>
        ) : null}
      </Section>

      <Section title="File notes" note="Newest first. Notes are permanent once written.">
        {page.notes.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">By</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {page.notes.map((item) => (
                  <tr key={item.id}>
                    <td className="date">{dateTime(item.createdAt)}</td>
                    <td>{item.authorName ?? 'Unknown'}</td>
                    <td>{item.body}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No notes yet" body="What was said, what was decided, what comes next." />
        )}

        <form
          className="stack"
          style={{ maxWidth: '44rem', marginTop: 'var(--s-6)' }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (note.trim() === '') return;
            if ((await addNote.run()) !== null) {
              setNote('');
              onChanged();
            }
          }}
        >
          {addNote.error ? <Notice tone="error">{addNote.error.message}</Notice> : null}
          <Field label="Add a note">
            {(props) => (
              <TextInput
                {...props}
                value={note}
                placeholder="Spoke with the insured; repair estimate expected Friday."
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          <div className="btn-row">
            <Button type="submit" loading={addNote.pending} disabled={note.trim() === ''}>
              Add note
            </Button>
          </div>
        </form>
      </Section>
    </>
  );
}

import { useState, type FormEvent } from "react";
import { useCreateEntity, useEntities } from "../api/hooks";

export default function EntitiesPage() {
  const { data: entities } = useEntities();
  const createEntity = useCreateEntity();

  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createEntity.mutate(
      { name, contactEmail: contactEmail || undefined },
      {
        onSuccess: () => {
          setName("");
          setContactEmail("");
        },
      },
    );
  }

  return (
    <div>
      <h1>Entities</h1>
      <p>Customer organizations that can be issued license keys.</p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Contact email</th>
            <th>License keys</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {entities?.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{e.contactEmail ?? "—"}</td>
              <td>{e._count.licenseKeys}</td>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {entities?.length === 0 && (
            <tr>
              <td colSpan={4}>No entities created yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="panel" onSubmit={handleCreate}>
        <h2>New entity</h2>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp" required />
        </label>
        <label>
          Contact email (optional)
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
        {createEntity.isError && <p className="error-text">{(createEntity.error as Error).message}</p>}
        <button type="submit" disabled={createEntity.isPending || !name.trim()}>
          {createEntity.isPending ? "Creating…" : "Create entity"}
        </button>
      </form>
    </div>
  );
}

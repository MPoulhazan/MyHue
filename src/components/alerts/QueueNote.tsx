/** Sous un plein écran : d'autres alertes attendent leur tour. */
export function QueueNote({ waiting }: { waiting: number }) {
    if (!waiting) return null;
    return <p className="alert-queue" role="status">Ensuite : {waiting} autre{waiting > 1 ? 's' : ''} alerte{waiting > 1 ? 's' : ''}</p>;
}

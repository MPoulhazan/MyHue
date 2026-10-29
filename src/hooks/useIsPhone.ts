import { useEffect, useState } from 'react';

const PHONE_QUERY = '(max-width: 760px)';

/** Téléphone : onglets en bas et une colonne ; sinon la tablette avec son rail. */
export function useIsPhone() {
    const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
    useEffect(() => {
        const mq = window.matchMedia(PHONE_QUERY);
        const onChange = () => setPhone(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return phone;
}

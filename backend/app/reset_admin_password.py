"""Explicit interactive password rotation; no startup reset of existing users."""
import getpass
import warnings
from sqlalchemy import select
from .main import SessionLocal, User, hasher

def main():
    warnings.simplefilter('error', getpass.GetPassWarning)
    username=input('Existing admin username: ')
    password=getpass.getpass('New password (12+ characters): ')
    repeat=getpass.getpass('Repeat new password: ')
    if len(password)<12 or password!=repeat:
        raise SystemExit('Passwords must match and contain 12+ characters; nothing changed.')
    with SessionLocal() as db:
        user=db.scalar(select(User).where(User.username==username,User.role=='admin'))
        if user is None:
            raise SystemExit('Admin not found; nothing changed.')
        user.password_hash=hasher.hash(password)
        db.commit()
    print('Admin password updated. Rotate SECRET_KEY to invalidate existing sessions.')

if __name__=='__main__':
    main()

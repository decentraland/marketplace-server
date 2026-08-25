import SQL from 'sql-template-strings'
import { DEFAULT_LIST_ID } from '../../src/migrations/favorites/1678303321034_default-list'
import { ListsNotFoundError } from '../../src/ports/favorites/lists/errors'
import { test } from '../components'

test('lists authorization', function ({ components }) {
  const victim = '0x1111111111111111111111111111111111111111'
  const attacker = '0x2222222222222222222222222222222222222222'

  afterEach(async () => {
    // Removing the lists cascades to their acl and picks rows; the default list (owned by the zero
    // address) is untouched.
    await components.favoritesDatabase.query(SQL`DELETE FROM favorites.lists WHERE user_address IN (${victim}, ${attacker})`)
  })

  describe('when checking whether a caller may edit the target lists of a bulk pick', () => {
    describe("and a target is another user's private list, which has no acl rows", () => {
      let victimListId: string

      beforeEach(async () => {
        const list = await components.lists.addList({ name: 'victim private list', userAddress: victim, private: true })
        victimListId = list.id
      })

      it('rejects the caller so nothing can be written to it', async () => {
        await expect(components.lists.checkNonEditableLists([victimListId], attacker)).rejects.toThrow(ListsNotFoundError)
      })
    })

    describe('and the target is the shared default list', () => {
      it('resolves because every caller may add to the default list', async () => {
        await expect(components.lists.checkNonEditableLists([DEFAULT_LIST_ID], attacker)).resolves.toBeUndefined()
      })
    })

    describe('and the target is a list the caller owns', () => {
      let ownListId: string

      beforeEach(async () => {
        const list = await components.lists.addList({ name: 'attacker own list', userAddress: attacker, private: true })
        ownListId = list.id
      })

      it('resolves', async () => {
        await expect(components.lists.checkNonEditableLists([ownListId], attacker)).resolves.toBeUndefined()
      })
    })

    describe('and the target is a private list shared with the caller through an edit grant', () => {
      let sharedListId: string

      beforeEach(async () => {
        const list = await components.lists.addList({ name: 'victim shared list', userAddress: victim, private: true })
        sharedListId = list.id
        await components.favoritesDatabase.query(
          SQL`INSERT INTO favorites.acl (list_id, permission, grantee) VALUES (${sharedListId}, 'edit', ${attacker})`
        )
      })

      it('resolves because the caller holds an edit grant', async () => {
        await expect(components.lists.checkNonEditableLists([sharedListId], attacker)).resolves.toBeUndefined()
      })
    })
  })
})

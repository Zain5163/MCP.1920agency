import { LoginForm } from '@/components/LoginForm'
import { Wordmark } from '@/components/Wordmark'

/**
 * Sign-in page. A server component so the wordmark (the product name, a setting
 * read on the server) is rendered here and handed to the client-side form.
 */
export default function LoginPage() {
  return <LoginForm wordmark={<Wordmark />} />
}
